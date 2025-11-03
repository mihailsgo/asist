import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createMockOrchestrator, formatDocType, parseRawData, statusLabels } from '../app-core.js';

describe('formatDocType', () => {
  it('inserts space before capital letters', () => {
    expect(formatDocType('PolicyRenewal')).toBe('Policy Renewal');
    expect(formatDocType('ClaimForm')).toBe('Claim Form');
  });

  it('handles empty input', () => {
    expect(formatDocType()).toBe('');
  });
});

describe('parseRawData', () => {
  it('maps raw manifest rows to internal documents', () => {
    const receivedAt = '2025-09-12T09:30:00+03:00';
    const [doc] = parseRawData([
      {
        insurer: 'LINK4',
        documentType: 'PolicyRenewal',
        employeeId: 'EMP001',
        employeeName: 'Alice',
        documentFilename: 'file.pdf',
        receivedAt
      }
    ]);

    expect(doc.id).toBe('EMP001-file.pdf');
    expect(doc.workflowStatus).toBe('pending');
    expect(doc.statusHistory).toHaveLength(1);
    expect(doc.statusHistory[0].status).toBe('pending');
    expect(doc.receivedDate).toBeInstanceOf(Date);
    expect(doc.receivedDate.toISOString()).toBe(new Date(receivedAt).toISOString());
  });
});

describe('createMockOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits ready statuses when queueing for signature', () => {
    const orchestrator = createMockOrchestrator();
    const events = [];
    orchestrator.subscribe((event) => events.push(event));

    vi.spyOn(Math, 'random').mockReturnValue(0);

    orchestrator.queueForSignature([
      { id: 'A', insurer: 'Test' },
      { id: 'B', insurer: 'Test' }
    ]);

    vi.runAllTimers();

    const streamEvents = events.filter((event) => event.type === 'stream');
    expect(streamEvents[0]).toEqual({ type: 'stream', active: true });
    expect(streamEvents.at(-1)).toEqual({ type: 'stream', active: false });

    const statusEvents = events.filter((event) => event.type === 'status');
    expect(statusEvents.map((event) => event.status)).toEqual(['ready', 'ready']);
  });

  it('cycles through signing stages and recovers from insurer error', () => {
    const orchestrator = createMockOrchestrator();
    const events = [];
    orchestrator.subscribe((event) => events.push(event));

    const randomValues = [0, 0, 0, 0.05, 0];
    vi.spyOn(Math, 'random').mockImplementation(() => randomValues.shift() ?? 0);

    orchestrator.startBatch([
      { id: 'A', insurer: 'Allianz' }
    ]);

    vi.runAllTimers();

    const statusEvents = events.filter((event) => event.type === 'status');
    expect(statusEvents.map((event) => event.status)).toEqual([
      'ready',
      'signing',
      'signed',
      'error',
      'ready',
      'signed',
      'delivered'
    ]);

    const errorEvent = statusEvents.find((event) => event.status === 'error');
    expect(errorEvent.context.message).toContain('Allianz');

    const readyEvent = statusEvents.filter((event) => event.status === 'ready')[1];
    expect(readyEvent.context.message).toContain('ready after remediation');

    const streamEvents = events.filter((event) => event.type === 'stream');
    expect(streamEvents[0]).toEqual({ type: 'stream', active: true });
    expect(streamEvents.at(-1)).toEqual({ type: 'stream', active: false });
  });

  it('allows manual error resolution', () => {
    const orchestrator = createMockOrchestrator();
    const events = [];
    orchestrator.subscribe((event) => events.push(event));

    orchestrator.resolveError('A');

    const statusEvents = events.filter((event) => event.type === 'status');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toEqual({
      type: 'status',
      id: 'A',
      status: 'ready',
      context: { message: 'Manual remediation complete.' }
    });
  });
});
