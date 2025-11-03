export const statusLabels = {
  pending: 'Awaiting validation',
  ready: 'Ready for signature',
  signing: 'Signature in progress',
  routed: 'Dispatched to insurer',
  delivered: 'Confirmation logged',
  error: 'Requires attention'
};

export const statusStepIndex = {
  pending: 1,
  ready: 2,
  signing: 3,
  routed: 4,
  delivered: 5,
  error: 3
};

export function formatDocType(value = '') {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function parseRawData(raw = []) {
  return raw.map((item) => {
    const id = `${item.employeeId}-${item.documentFilename}`;
    const receivedAt = item.receivedAt ? new Date(item.receivedAt) : new Date();
    return {
      ...item,
      id,
      workflowStatus: 'pending',
      statusHistory: [
        {
          status: 'pending',
          at: receivedAt
        }
      ],
      errorMessage: null,
      receivedDate: receivedAt
    };
  });
}

export function createMockOrchestrator() {
  const listeners = new Set();
  let timers = [];
  let active = false;

  const notify = (event) => {
    listeners.forEach((fn) => fn(event));
  };

  const setActive = (value) => {
    if (active === value) return;
    active = value;
    notify({ type: 'stream', active });
  };

  const clearTimers = () => {
    timers.forEach((id) => window.clearTimeout(id));
    timers = [];
  };

  const planFinalise = (duration) => {
    timers.push(window.setTimeout(() => setActive(false), duration));
  };

  const queueForSignature = (items) => {
    if (!items.length) {
      notify({ type: 'toast', variant: 'info', message: 'No documents matched the current filters.' });
      return;
    }
    setActive(true);
    items.forEach((item, index) => {
      const delay = 120 * index + Math.random() * 120;
      timers.push(window.setTimeout(() => {
        notify({ type: 'status', id: item.id, status: 'ready' });
      }, delay));
    });
    planFinalise(items.length * 140 + 600);
  };

  const startBatch = (items) => {
    if (!items.length) {
      notify({ type: 'toast', variant: 'info', message: 'Nothing queued for signing.' });
      return;
    }
    clearTimers();
    setActive(true);

    const stageTimeline = [
      { status: 'ready', delay: 500 },
      { status: 'signing', delay: 700 },
      { status: 'routed', delay: 900 },
      { status: 'delivered', delay: 1000 }
    ];

    items.forEach((item, index) => {
      let scheduledAt = index * 280;

      const queueStage = (stageIndex) => {
        if (stageIndex >= stageTimeline.length) return;
        const { status, delay } = stageTimeline[stageIndex];
        const jitter = Math.random() * 300;
        scheduledAt += delay + jitter;

        const timerId = window.setTimeout(() => {
          if (status === 'routed' && Math.random() < 0.12) {
            notify({
              type: 'status',
              id: item.id,
              status: 'error',
              context: { message: `${item.insurer} validation required additional data.` }
            });

            timers.push(window.setTimeout(() => {
              notify({
                type: 'status',
                id: item.id,
                status: 'ready',
                context: { message: `${item.insurer} ready after remediation.` }
              });

              timers.push(window.setTimeout(() => {
                notify({ type: 'status', id: item.id, status: 'delivered' });
              }, 900));
            }, 1600));
            return;
          }

          notify({ type: 'status', id: item.id, status });

          if (stageIndex + 1 < stageTimeline.length) {
            queueStage(stageIndex + 1);
          }
        }, scheduledAt);

        timers.push(timerId);
      };

      queueStage(0);
    });

    const recoveryWindow = 2600;
    const longest = Math.max(0, items.length - 1) * 280 + 3600 + recoveryWindow;
    planFinalise(longest);
  };

  const resolveError = (id) => {
    notify({ type: 'status', id, status: 'ready', context: { message: 'Manual remediation complete.' } });
  };

  return {
    subscribe: (fn) => listeners.add(fn),
    unsubscribe: (fn) => listeners.delete(fn),
    queueForSignature,
    startBatch,
    resolveError
  };
}