(() => {
  // ui/app-core.js
  var statusLabels = {
    pending: "Awaiting validation",
    ready: "Ready for signature",
    signing: "Signature in progress",
    routed: "Dispatched to insurer",
    delivered: "Confirmation logged",
    error: "Requires attention"
  };
  var statusStepIndex = {
    pending: 1,
    ready: 2,
    signing: 3,
    routed: 4,
    delivered: 5,
    error: 3
  };
  function formatDocType(value = "") {
    return value.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  function parseRawData(raw = []) {
    return raw.map((item) => {
      const id = `${item.employeeId}-${item.documentFilename}`;
      const receivedAt = item.receivedAt ? new Date(item.receivedAt) : /* @__PURE__ */ new Date();
      return {
        ...item,
        id,
        workflowStatus: "pending",
        statusHistory: [
          {
            status: "pending",
            at: receivedAt
          }
        ],
        errorMessage: null,
        receivedDate: receivedAt
      };
    });
  }
  function createMockOrchestrator() {
    const listeners = /* @__PURE__ */ new Set();
    let timers = [];
    let active = false;
    const notify = (event) => {
      listeners.forEach((fn) => fn(event));
    };
    const setActive = (value) => {
      if (active === value) return;
      active = value;
      notify({ type: "stream", active });
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
        notify({ type: "toast", variant: "info", message: "No documents matched the current filters." });
        return;
      }
      setActive(true);
      items.forEach((item, index) => {
        const delay = 120 * index + Math.random() * 120;
        timers.push(window.setTimeout(() => {
          notify({ type: "status", id: item.id, status: "ready" });
        }, delay));
      });
      planFinalise(items.length * 140 + 600);
    };
    const startBatch = (items) => {
      if (!items.length) {
        notify({ type: "toast", variant: "info", message: "Nothing queued for signing." });
        return;
      }
      clearTimers();
      setActive(true);
      const stageTimeline = [
        { status: "ready", delay: 500 },
        { status: "signing", delay: 700 },
        { status: "routed", delay: 900 },
        { status: "delivered", delay: 1e3 }
      ];
      items.forEach((item, index) => {
        let scheduledAt = index * 280;
        const queueStage = (stageIndex) => {
          if (stageIndex >= stageTimeline.length) return;
          const { status, delay } = stageTimeline[stageIndex];
          const jitter = Math.random() * 300;
          scheduledAt += delay + jitter;
          const timerId = window.setTimeout(() => {
            if (status === "routed" && Math.random() < 0.12) {
              notify({
                type: "status",
                id: item.id,
                status: "error",
                context: { message: `${item.insurer} validation required additional data.` }
              });
              timers.push(window.setTimeout(() => {
                notify({
                  type: "status",
                  id: item.id,
                  status: "ready",
                  context: { message: `${item.insurer} ready after remediation.` }
                });
                timers.push(window.setTimeout(() => {
                  notify({ type: "status", id: item.id, status: "delivered" });
                }, 900));
              }, 1600));
              return;
            }
            notify({ type: "status", id: item.id, status });
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
      notify({ type: "status", id, status: "ready", context: { message: "Manual remediation complete." } });
    };
    return {
      subscribe: (fn) => listeners.add(fn),
      unsubscribe: (fn) => listeners.delete(fn),
      queueForSignature,
      startBatch,
      resolveError
    };
  }

  // ui/app.js
  (() => {
    const tableBody = document.getElementById("document-table");
    const detailModal = document.getElementById("detail-modal");
    const modalCard = detailModal ? detailModal.querySelector(".modal-card") : null;
    const detailTitle = document.getElementById("detail-title");
    const detailSubtitle = document.getElementById("detail-subtitle");
    const detailFilename = document.getElementById("detail-filename");
    const detailMeta = document.getElementById("detail-meta");
    const detailTimeline = document.getElementById("detail-timeline");
    const detailProgressLabel = document.getElementById("detail-progress-label");
    const signingOptionsEl = document.getElementById("signing-options");
    const signingRecommendationEl = document.getElementById("signing-recommendation");
    const bulkModal = document.getElementById("bulk-modal");
    const bulkCard = bulkModal ? bulkModal.querySelector(".bulk-card") : null;
    const bulkDocList = document.getElementById("bulk-doc-list");
    const bulkSelectionCount = document.getElementById("bulk-selection-count");
    const bulkSigningOptionsEl = document.getElementById("bulk-signing-options");
    const bulkSigningRecommendationEl = document.getElementById("bulk-signing-recommendation");
    const toastContainer = document.querySelector(".toast-container");
    const insurerFilter = document.getElementById("insurer-filter");
    const typeFilter = document.getElementById("type-filter");
    const signatureFilter = document.getElementById("signature-filter");
    const searchInput = document.getElementById("search-input");
    const inputPathEl = document.getElementById("input-folder-path");
    const outputPathEl = document.getElementById("output-folder-path");
    const outputMetaEl = document.getElementById("output-folder-meta");
    const inputSummaryEl = document.getElementById("input-folder-summary");
    const outputSummaryEl = document.getElementById("output-folder-summary");
    const liveIndicator = document.getElementById("live-indicator");
    const signNowButton = document.querySelector('[data-action="sign-now"]');
    const routeButton = document.querySelector('[data-action="route"]');
    const flagButton = document.querySelector('[data-action="flag"]');
    const openBulkButton = document.querySelector('[data-action="open-bulk-sign"]');
    const confirmBulkButton = document.querySelector('[data-action="confirm-bulk-sign"]');
    const sortTriggers = Array.from(document.querySelectorAll("[data-sort]"));
    const fallbackData = [
      {
        insurer: "LINK4",
        documentType: "PolicyRenewal",
        employeeId: "EMP101",
        employeeName: "Alice Kowalski",
        documentFilename: "20250912-PolicyRenewal-EMP101.pdf",
        receivedAt: "2025-09-12T09:30:00+03:00",
        signatureRequirement: "QES",
        deliveryChannel: "Email",
        deliveryTarget: "policy-renewal@link4-sandbox.example.com",
        status: "pending",
        notes: "Fallback dataset sample."
      },
      {
        insurer: "Nationale",
        documentType: "ClaimForm",
        employeeId: "EMP102",
        employeeName: "Damian Wrobel",
        documentFilename: "20250910-ClaimForm-EMP102.pdf",
        receivedAt: "2025-09-10T14:10:00+03:00",
        signatureRequirement: "AES",
        deliveryChannel: "API",
        deliveryTarget: "https://sandbox.nationale.example/api/claim-form",
        status: "pending",
        notes: "Fallback dataset sample."
      }
    ];
    const signingMethods = [
      { id: "eu-qes", label: "EU Qualified", short: "EU", hint: "Qualified cross-border flow", tier: "QES" },
      { id: "pl-trusted", label: "Poland Trusted", short: "PL", hint: "Profil Zaufany & KIR", tier: "QES" },
      { id: "smart-id", label: "Smart-ID", short: "ID", hint: "Baltic remote signature", tier: "AES" },
      { id: "simplysign", label: "SimplySign", short: "SS", hint: "Mobile signing suite", tier: "QES" },
      { id: "latvia", label: "Latvia eSeal", short: "LV", hint: "LVRTC integration ready", tier: "QES" },
      { id: "estonia", label: "Estonia ID-Card", short: "EE", hint: "X-Road secure identity", tier: "QES" }
    ];
    const state = {
      items: [],
      filtered: [],
      selectedId: null,
      selectedIds: /* @__PURE__ */ new Set(),
      selectedSigningMethod: null,
      recommendedSigningMethod: null,
      bulkSelectedMethod: null,
      bulkRecommendedMethod: null,
      sort: {
        key: "receivedDate",
        direction: "desc"
      },
      inputFolder: "c:\\Repos\\ASIST\\in",
      outputFolder: "c:\\Repos\\ASIST\\out",
      streaming: false
    };
    const orchestrator = createMockOrchestrator();
    orchestrator.subscribe(handleServiceEvent);
    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    function formatDate(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return "-";
      }
      return dateFormatter.format(date);
    }
    function renderMetrics(items) {
      const totalMetric = document.querySelector('[data-metric="total"] .metric-value');
      totalMetric.textContent = items.length.toString().padStart(2, "0");
      const signatureCounts = items.reduce((acc, item) => {
        acc[item.signatureRequirement] = (acc[item.signatureRequirement] || 0) + 1;
        return acc;
      }, {});
      const signatureMetric = document.querySelector('[data-metric="signature"] .metric-value');
      const qes = signatureCounts.QES || 0;
      const aes = signatureCounts.AES || 0;
      signatureMetric.textContent = `${qes} QES / ${aes} AES`;
      const deliveryCounts = items.reduce((acc, item) => {
        acc[item.deliveryChannel] = (acc[item.deliveryChannel] || 0) + 1;
        return acc;
      }, {});
      const deliveryMetric = document.querySelector('[data-metric="delivery"] .metric-value');
      const emails = deliveryCounts.Email || 0;
      const apis = deliveryCounts.API || 0;
      deliveryMetric.textContent = `${emails} Email / ${apis} API`;
      const exceptionMetric = document.querySelector('[data-metric="exceptions"] .metric-value');
      const exceptions = items.filter((item) => item.workflowStatus === "error").length;
      exceptionMetric.textContent = exceptions.toString();
      exceptionMetric.classList.toggle("ok", exceptions === 0);
    }
    function populateFilters(items) {
      const insurers = Array.from(new Set(items.map((item) => item.insurer))).sort(collator.compare);
      const docTypes = Array.from(new Set(items.map((item) => item.documentType))).sort(collator.compare);
      insurerFilter.innerHTML = '<option value="all">All</option>' + insurers.map((value) => `<option value="${value}">${value}</option>`).join("");
      typeFilter.innerHTML = '<option value="all">All</option>' + docTypes.map((value) => `<option value="${value}">${formatDocType(value)}</option>`).join("");
    }
    function getSortValue(doc, key) {
      switch (key) {
        case "document":
          return `${formatDocType(doc.documentType)} ${doc.documentFilename}`;
        case "insurer":
          return doc.insurer;
        case "signature":
          return doc.signatureRequirement;
        case "channel":
          return doc.deliveryChannel;
        case "status":
          return statusLabels[doc.workflowStatus] || doc.workflowStatus;
        case "receivedDate":
        default:
          return doc.receivedDate instanceof Date ? doc.receivedDate.getTime() : 0;
      }
    }
    function sortItems(items) {
      const { key, direction } = state.sort;
      const factor = direction === "asc" ? 1 : -1;
      return [...items].sort((a, b) => {
        const aVal = getSortValue(a, key);
        const bVal = getSortValue(b, key);
        if (typeof aVal === "number" && typeof bVal === "number") {
          return (aVal - bVal) * factor;
        }
        return collator.compare(String(aVal), String(bVal)) * factor;
      });
    }
    function updateSortIndicators() {
      sortTriggers.forEach((trigger) => {
        const key = trigger.getAttribute("data-sort");
        const isActive = key === state.sort.key;
        trigger.classList.toggle("sorted", isActive);
        trigger.classList.toggle("sorted-asc", isActive && state.sort.direction === "asc");
        trigger.classList.toggle("sorted-desc", isActive && state.sort.direction === "desc");
        trigger.setAttribute("aria-sort", isActive ? state.sort.direction === "asc" ? "ascending" : "descending" : "none");
      });
    }
    function applyFilters() {
      const insurerValue = insurerFilter.value;
      const typeValue = typeFilter.value;
      const signatureValue = signatureFilter.value;
      const searchValue = searchInput.value.trim().toLowerCase();
      const filtered = state.items.filter((item) => {
        const matchesInsurer = insurerValue === "all" || item.insurer === insurerValue;
        const matchesType = typeValue === "all" || item.documentType === typeValue;
        const matchesSignature = signatureValue === "all" || item.signatureRequirement === signatureValue;
        const matchesSearch = !searchValue || Object.values(item).some((value) => typeof value === "string" && value.toLowerCase().includes(searchValue));
        return matchesInsurer && matchesType && matchesSignature && matchesSearch;
      });
      if (state.selectedId && !filtered.some((item) => item.id === state.selectedId)) {
        closeDetail();
      }
      const filteredIds = new Set(filtered.map((item) => item.id));
      Array.from(state.selectedIds).forEach((id) => {
        if (!filteredIds.has(id)) {
          state.selectedIds.delete(id);
        }
      });
      state.filtered = filtered;
      renderTable();
      renderMetrics(filtered);
      updateFolderCards();
      updateBulkSelectionUI();
    }
    function renderTable(items = state.filtered) {
      const sorted = sortItems(items);
      state.filtered = sorted;
      updateSortIndicators();
      if (!sorted.length) {
        tableBody.innerHTML = '<tr><td colspan="8" class="empty">No documents match your filters.</td></tr>';
        return;
      }
      const rows = sorted.map((item) => {
        const rowClasses = [];
        if (state.selectedIds.has(item.id)) rowClasses.push("selected");
        if (state.selectedId === item.id) rowClasses.push("detail-active");
        if (item.flash) rowClasses.push("row-flash");
        const statusClass = `status-pill ${item.workflowStatus}`;
        const statusLabel = statusLabels[item.workflowStatus] || item.workflowStatus;
        const badgeSignature = item.signatureRequirement === "QES" ? "badge qes" : "badge aes";
        const badgeChannel = item.deliveryChannel === "Email" ? "badge email" : "badge api";
        const received = formatDate(item.receivedDate);
        const isSelected = state.selectedIds.has(item.id);
        const checkboxId = `select-${item.id}`;
        item.flash = false;
        return `
        <tr data-id="${item.id}" class="${rowClasses.join(" ")}">
          <td class="select-cell">
            <label class="row-select" for="${checkboxId}">
              <input type="checkbox" id="${checkboxId}" data-id="${item.id}" ${isSelected ? "checked" : ""} aria-label="Select ${formatDocType(item.documentType)}">
              <span></span>
            </label>
          </td>
          <td>
            <div class="doc-primary">${formatDocType(item.documentType)}</div>
            <div class="doc-secondary">${item.documentFilename}</div>
          </td>
          <td>${item.insurer}</td>
          <td><span class="${badgeSignature}">${item.signatureRequirement}</span></td>
          <td><span class="${badgeChannel}">${item.deliveryChannel}</span></td>
          <td>${received}</td>
          <td><span class="${statusClass}">${statusLabel}</span></td>
          <td class="row-action"><span>Details</span><svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 12 12"><path fill="currentColor" d="M2.2 9.8l6.7-6.7H3.6a.6.6 0 010-1.2h6.5c.33 0 .6.27.6.6v6.5a.6.6 0 01-1.2 0V3.1L2.8 9.8a.6.6 0 01-.85-.85z"/></svg></td>
        </tr>
      `;
      }).join("");
      tableBody.innerHTML = rows;
      tableBody.querySelectorAll("tr").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target.closest(".row-select")) {
            return;
          }
          const id = row.getAttribute("data-id");
          const doc = state.items.find((item) => item.id === id);
          if (doc) {
            openDetail(doc);
          }
        });
        const checkbox = row.querySelector('.row-select input[type="checkbox"]');
        if (checkbox) {
          checkbox.addEventListener("click", (event) => {
            event.stopPropagation();
            const { id } = event.target.dataset;
            toggleSelection(id, event.target.checked);
          });
        }
      });
    }
    function highlightRow(id) {
      tableBody.querySelectorAll("tr").forEach((row) => {
        row.classList.toggle("detail-active", row.getAttribute("data-id") === id);
      });
    }
    function toggleSelection(id, isSelected) {
      if (isSelected) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      const row = tableBody.querySelector(`tr[data-id="${id}"]`);
      if (row) {
        row.classList.toggle("selected", state.selectedIds.has(id));
        const checkbox = row.querySelector('.row-select input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = state.selectedIds.has(id);
        }
      }
      updateBulkSelectionUI();
    }
    function updateBulkSelectionUI() {
      if (!openBulkButton) return;
      const count = state.selectedIds.size;
      openBulkButton.disabled = count === 0;
      openBulkButton.textContent = count ? `Review & Sign Selected (${count})` : "Review & Sign Selected";
      openBulkButton.classList.toggle("active", count > 0);
    }
    function buildTimeline(doc) {
      const stages = [
        { key: "pending", label: "Intake received" },
        { key: "ready", label: "Data validated" },
        { key: "signing", label: "Signature sequencing" },
        { key: "routed", label: "Batch signing" },
        { key: "delivered", label: "Delivery + confirmation" }
      ];
      const activeIndex = statusStepIndex[doc.workflowStatus] || 1;
      const errorIndex = doc.workflowStatus === "error" ? statusStepIndex.error - 1 : null;
      return stages.map((stage, index) => {
        const classes = [];
        if (index < activeIndex) classes.push("active");
        if (errorIndex !== null && index === errorIndex) classes.push("error");
        const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
        return `<li${classAttr}>${stage.label}</li>`;
      }).join("");
    }
    function getMethodById(id) {
      return signingMethods.find((method) => method.id === id) || null;
    }
    function recommendedMethodFor(doc) {
      if (doc.signatureRequirement === "AES") return "smart-id";
      if (doc.signatureRequirement === "QES") return "eu-qes";
      return "eu-qes";
    }
    function recommendedMethodForDocs(docs) {
      if (!docs.length) return "eu-qes";
      if (docs.some((doc) => doc.signatureRequirement === "AES")) return "smart-id";
      return "eu-qes";
    }
    function setBulkSigningSelection(methodId) {
      state.bulkSelectedMethod = methodId;
      if (!bulkSigningOptionsEl) return;
      bulkSigningOptionsEl.querySelectorAll(".signing-option").forEach((button) => {
        const isActive = button.getAttribute("data-method") === methodId;
        button.classList.toggle("selected", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }
    function renderBulkSigningOptions(docs) {
      if (!bulkSigningOptionsEl) return;
      const recommended = recommendedMethodForDocs(docs);
      state.bulkRecommendedMethod = recommended;
      state.bulkSelectedMethod = recommended;
      const recommendedLabel = getMethodById(recommended)?.label || "-";
      if (bulkSigningRecommendationEl) {
        bulkSigningRecommendationEl.textContent = recommendedLabel;
      }
      bulkSigningOptionsEl.innerHTML = signingMethods.map((method) => {
        const classes = ["signing-option"];
        if (method.id === recommended) classes.push("recommended");
        if (method.id === state.bulkSelectedMethod) classes.push("selected");
        return `
        <button type="button" class="${classes.join(" ")}" data-method="${method.id}" aria-pressed="${method.id === state.bulkSelectedMethod}">
          <span class="signing-icon">${method.short}</span>
          <span class="signing-copy">
            <span class="signing-label">${method.label}</span>
            <span class="signing-hint">${method.hint}</span>
          </span>
          <span class="signing-tier">${method.tier}</span>
        </button>
      `;
      }).join("");
      bulkSigningOptionsEl.querySelectorAll(".signing-option").forEach((button) => {
        button.addEventListener("click", () => {
          const methodId = button.getAttribute("data-method");
          setBulkSigningSelection(methodId);
        });
      });
    }
    function updateSignNowLabel() {
      if (!signNowButton) return;
      const method = getMethodById(state.selectedSigningMethod);
      signNowButton.textContent = method ? `Begin Signing - ${method.label}` : "Begin Signing";
    }
    function setSigningSelection(methodId) {
      state.selectedSigningMethod = methodId;
      if (signingOptionsEl) {
        signingOptionsEl.querySelectorAll(".signing-option").forEach((button) => {
          const isActive = button.getAttribute("data-method") === methodId;
          button.classList.toggle("selected", isActive);
          button.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
      }
      updateSignNowLabel();
    }
    function renderSigningOptions(doc) {
      if (!signingOptionsEl) return;
      const recommended = recommendedMethodFor(doc);
      state.recommendedSigningMethod = recommended;
      state.selectedSigningMethod = recommended;
      const recommendedLabel = getMethodById(recommended)?.label || "-";
      if (signingRecommendationEl) {
        signingRecommendationEl.textContent = recommendedLabel;
      }
      signingOptionsEl.innerHTML = signingMethods.map((method) => {
        const classes = ["signing-option"];
        if (method.id === recommended) classes.push("recommended");
        if (method.id === state.selectedSigningMethod) classes.push("selected");
        return `
        <button type="button" class="${classes.join(" ")}" data-method="${method.id}" aria-pressed="${method.id === state.selectedSigningMethod}">
          <span class="signing-icon">${method.short}</span>
          <span class="signing-copy">
            <span class="signing-label">${method.label}</span>
            <span class="signing-hint">${method.hint}</span>
          </span>
          <span class="signing-tier">${method.tier}</span>
        </button>
      `;
      }).join("");
      signingOptionsEl.querySelectorAll(".signing-option").forEach((button) => {
        button.addEventListener("click", () => {
          const methodId = button.getAttribute("data-method");
          setSigningSelection(methodId);
        });
      });
      updateSignNowLabel();
    }
    function openDetail(doc) {
      state.selectedId = doc.id;
      detailTitle.textContent = formatDocType(doc.documentType);
      detailSubtitle.textContent = `${doc.employeeName} | ${doc.insurer}`;
      if (detailFilename) {
        detailFilename.textContent = doc.documentFilename;
      }
      const metaEntries = [
        { label: "Employee ID", value: doc.employeeId },
        { label: "Signature", value: doc.signatureRequirement },
        { label: "Delivery channel", value: doc.deliveryChannel },
        { label: "Delivery target", value: doc.deliveryTarget },
        { label: "Received", value: formatDate(doc.receivedDate) },
        { label: "Notes", value: doc.notes || "-" }
      ];
      if (doc.workflowStatus === "error" && doc.errorMessage) {
        metaEntries.push({ label: "Alert", value: doc.errorMessage });
      }
      detailMeta.innerHTML = metaEntries.map(({ label, value }) => `
      <div class="detail-meta-item">
        <span class="label">${label}</span>
        <span class="value">${value}</span>
      </div>
    `).join("");
      detailTimeline.innerHTML = buildTimeline(doc);
      detailProgressLabel.textContent = statusLabels[doc.workflowStatus] || doc.workflowStatus;
      renderSigningOptions(doc);
      highlightRow(doc.id);
      if (detailModal) {
        detailModal.classList.remove("hidden");
        detailModal.classList.add("visible");
        detailModal.setAttribute("aria-hidden", "false");
      }
      document.body.classList.add("modal-open");
      if (modalCard) {
        modalCard.focus();
      }
    }
    function closeDetail() {
      if (detailModal) {
        detailModal.classList.add("hidden");
        detailModal.classList.remove("visible");
        detailModal.setAttribute("aria-hidden", "true");
      }
      if (!bulkModal || !bulkModal.classList.contains("visible")) {
        document.body.classList.remove("modal-open");
      }
      state.selectedId = null;
      state.selectedSigningMethod = null;
      state.recommendedSigningMethod = null;
      if (signingOptionsEl) {
        signingOptionsEl.innerHTML = "";
      }
      updateSignNowLabel();
      highlightRow(null);
    }
    function openBulkSignModal() {
      const docs = state.items.filter((item) => state.selectedIds.has(item.id));
      if (!docs.length) {
        showToast("Select one or more documents to sign.", "info");
        return;
      }
      if (bulkDocList) {
        bulkDocList.innerHTML = docs.map((doc) => `
        <li>
          <span class="doc-title">${formatDocType(doc.documentType)}</span>
          <span class="doc-meta">${doc.documentFilename}</span>
          <span class="doc-chip">${doc.insurer}</span>
          <span class="doc-chip">${doc.signatureRequirement}</span>
        </li>
      `).join("");
      }
      if (bulkSelectionCount) {
        const count = docs.length;
        bulkSelectionCount.textContent = `${count} document${count > 1 ? "s" : ""} selected`;
      }
      renderBulkSigningOptions(docs);
      if (bulkModal) {
        bulkModal.classList.remove("hidden");
        bulkModal.classList.add("visible");
        bulkModal.setAttribute("aria-hidden", "false");
      }
      document.body.classList.add("modal-open");
      if (bulkCard) {
        bulkCard.focus();
      }
    }
    function closeBulkModal() {
      if (bulkModal) {
        bulkModal.classList.add("hidden");
        bulkModal.classList.remove("visible");
        bulkModal.setAttribute("aria-hidden", "true");
      }
      if (!detailModal || !detailModal.classList.contains("visible")) {
        document.body.classList.remove("modal-open");
      }
      state.bulkSelectedMethod = null;
      state.bulkRecommendedMethod = null;
      if (bulkSigningOptionsEl) {
        bulkSigningOptionsEl.innerHTML = "";
      }
      updateBulkSelectionUI();
    }
    function showToast(message, variant = "success") {
      if (!toastContainer) return;
      const toast = document.createElement("div");
      toast.className = `toast ${variant}`.trim();
      toast.textContent = message;
      toastContainer.appendChild(toast);
      window.setTimeout(() => {
        toast.classList.add("fade");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
        window.setTimeout(() => toast.remove(), 700);
      }, 2800);
    }
    function updateFolderCards() {
      inputPathEl.textContent = state.inputFolder;
      outputPathEl.textContent = state.outputFolder;
      const pendingCount = state.items.filter((item) => item.workflowStatus !== "delivered").length;
      const deliveredCount = state.items.filter((item) => item.workflowStatus === "delivered").length;
      inputSummaryEl.textContent = `${pendingCount} awaiting orchestration`;
      outputSummaryEl.textContent = deliveredCount ? `${deliveredCount} delivered artifacts ready` : "Awaiting first delivery";
      outputMetaEl.classList.toggle("delivered", deliveredCount > 0);
    }
    function updateLiveIndicator(active) {
      liveIndicator.classList.toggle("active", active);
      liveIndicator.classList.toggle("inactive", !active);
      const message = active ? "Live sync streaming" : "Live sync idle";
      const messageEl = liveIndicator.querySelector(".status-message");
      if (messageEl) {
        messageEl.textContent = message;
      }
    }
    function promptForFolder(kind, currentValue) {
      const proposed = window.prompt(`Set ${kind} folder path`, currentValue);
      if (!proposed) {
        return null;
      }
      return proposed.trim();
    }
    function setStatus(id, status, context = {}) {
      const doc = state.items.find((item) => item.id === id);
      if (!doc || doc.workflowStatus === status) return;
      doc.workflowStatus = status;
      doc.statusHistory.push({ status, at: /* @__PURE__ */ new Date() });
      doc.flash = true;
      if (status === "error") {
        doc.errorMessage = context.message || "Insurer requested manual review.";
        showToast(`${doc.documentFilename} flagged: ${doc.errorMessage}`, "error");
      } else if (status === "delivered") {
        doc.errorMessage = null;
        showToast(`${doc.documentFilename} delivered to ${doc.insurer}`, "success");
      } else if (status === "ready" && context.message) {
        showToast(context.message, "info");
      }
      renderTable();
      renderMetrics(state.filtered);
      updateFolderCards();
      if (state.selectedId === doc.id) {
        openDetail(doc);
      }
    }
    function handleServiceEvent(event) {
      if (!event) return;
      if (event.type === "status") {
        setStatus(event.id, event.status, event.context || {});
      } else if (event.type === "stream") {
        state.streaming = event.active;
        updateLiveIndicator(event.active);
        if (!event.active) {
          showToast("Streaming cycle completed.", "info");
        }
      } else if (event.type === "toast") {
        showToast(event.message, event.variant || "info");
      }
    }
    function handleSortChange(key) {
      if (!key) return;
      if (state.sort.key === key) {
        state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = key;
        state.sort.direction = key === "receivedDate" ? "desc" : "asc";
      }
      renderTable();
    }
    function wireActions() {
      insurerFilter.addEventListener("change", applyFilters);
      typeFilter.addEventListener("change", applyFilters);
      signatureFilter.addEventListener("change", applyFilters);
      searchInput.addEventListener("input", () => {
        window.clearTimeout(searchInput._debounce);
        searchInput._debounce = window.setTimeout(applyFilters, 180);
      });
      document.querySelector('[data-action="clear-filters"]').addEventListener("click", () => {
        insurerFilter.value = "all";
        typeFilter.value = "all";
        signatureFilter.value = "all";
        searchInput.value = "";
        applyFilters();
        showToast("Filters reset. Showing full intake.", "info");
      });
      document.querySelector('[data-action="queue-signature"]').addEventListener("click", () => {
        orchestrator.queueForSignature([...state.filtered]);
        showToast(`${state.filtered.length} queued for signature sequencing.`, "info");
      });
      document.querySelector('[data-action="trigger-batch"]').addEventListener("click", () => {
        orchestrator.startBatch([...state.filtered]);
        showToast("Batch signing initiated. Monitoring stream.", "success");
      });
      document.querySelector('[data-action="start-demo"]').addEventListener("click", () => {
        orchestrator.queueForSignature([...state.items]);
        showToast("Guided demo launched - intake normalization in progress.", "info");
        window.setTimeout(() => orchestrator.startBatch([...state.items]), 450);
      });
      document.querySelector('[data-action="export-report"]').addEventListener("click", () => {
        showToast("Compliance snapshot exported (mock).", "success");
      });
      document.querySelector('[data-action="select-input"]').addEventListener("click", () => {
        const next = promptForFolder("input", state.inputFolder);
        if (next) {
          state.inputFolder = next;
          updateFolderCards();
          showToast(`Input folder set to ${next}`, "info");
        }
      });
      document.querySelector('[data-action="select-output"]').addEventListener("click", () => {
        const next = promptForFolder("output", state.outputFolder);
        if (next) {
          state.outputFolder = next;
          updateFolderCards();
          showToast(`Output folder set to ${next}`, "info");
        }
      });
      signNowButton.addEventListener("click", () => {
        if (!state.selectedId) {
          showToast("Select a document to fast-track signing.", "info");
          return;
        }
        if (!state.selectedSigningMethod) {
          showToast("Choose a signing method to continue.", "info");
          return;
        }
        const doc = state.items.find((item) => item.id === state.selectedId);
        if (!doc) {
          showToast("Document no longer available.", "error");
          closeDetail();
          return;
        }
        const method = getMethodById(state.selectedSigningMethod);
        orchestrator.startBatch([doc]);
        const methodLabel = method ? method.label : "selected method";
        showToast(`Signing ${doc.documentFilename} via ${methodLabel}.`, "success");
      });
      routeButton.addEventListener("click", () => {
        if (!state.selectedId) {
          showToast("Select a document to route.", "info");
          return;
        }
        setStatus(state.selectedId, "routed");
      });
      flagButton.addEventListener("click", () => {
        if (!state.selectedId) {
          showToast("Select a document to flag.", "info");
          return;
        }
        setStatus(state.selectedId, "error", { message: "Manually flagged by operator." });
      });
      if (openBulkButton) {
        openBulkButton.addEventListener("click", openBulkSignModal);
      }
      if (confirmBulkButton) {
        confirmBulkButton.addEventListener("click", () => {
          const docs = state.items.filter((item) => state.selectedIds.has(item.id));
          if (!docs.length) {
            showToast("Select one or more documents to sign.", "info");
            closeBulkModal();
            return;
          }
          if (!state.bulkSelectedMethod) {
            showToast("Choose a signing method to continue.", "info");
            return;
          }
          const methodLabel = getMethodById(state.bulkSelectedMethod)?.label || "selected method";
          showToast(`Signing ${docs.length} documents via ${methodLabel}.`, "success");
          closeBulkModal();
          state.selectedIds.clear();
          renderTable();
          updateBulkSelectionUI();
        });
      }
      if (detailModal) {
        detailModal.querySelectorAll("[data-modal-dismiss]").forEach((el) => {
          el.addEventListener("click", closeDetail);
        });
      }
      if (bulkModal) {
        bulkModal.querySelectorAll("[data-bulk-dismiss]").forEach((el) => {
          el.addEventListener("click", () => {
            closeBulkModal();
          });
        });
      }
      sortTriggers.forEach((trigger) => {
        trigger.addEventListener("click", () => {
          handleSortChange(trigger.getAttribute("data-sort"));
        });
        trigger.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleSortChange(trigger.getAttribute("data-sort"));
          }
        });
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          if (detailModal && detailModal.classList.contains("visible")) {
            closeDetail();
          } else if (bulkModal && bulkModal.classList.contains("visible")) {
            closeBulkModal();
          }
        }
      });
    }
    function init() {
      const raw = Array.isArray(window.manifestData) && window.manifestData.length ? window.manifestData : fallbackData;
      state.items = parseRawData(raw);
      state.filtered = [...state.items];
      updateFolderCards();
      populateFilters(state.items);
      renderMetrics(state.filtered);
      renderTable(state.filtered);
      updateLiveIndicator(false);
      updateBulkSelectionUI();
      wireActions();
    }
    document.addEventListener("DOMContentLoaded", init);
  })();
})();
//# sourceMappingURL=app.bundle.js.map
