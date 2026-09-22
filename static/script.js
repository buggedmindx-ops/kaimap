// Frontend logic: send form data to Flask, then draw the answer.

const form = document.getElementById("scan-form");
const scanBtn = document.getElementById("scan-btn");
const message = document.getElementById("message");
const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const table = document.getElementById("table");
const tableBody = document.getElementById("table-body");
const historyList = document.getElementById("history-list");

const targetInput = document.getElementById("target");
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const customPortsInput = document.getElementById("custom-ports");
const timeoutInput = document.getElementById("timeout");
const timeoutOut = document.getElementById("timeout-out");
const rangeFields = document.getElementById("range-fields");
const customFields = document.getElementById("custom-fields");

timeoutInput.addEventListener("input", () => (timeoutOut.textContent = timeoutInput.value));

// Toggle range vs custom-list fields
document.querySelectorAll('input[name="port_mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const custom = radio.value === "custom" && radio.checked;
    rangeFields.hidden = custom;
    customFields.hidden = !custom;
  });
});

// Preset buttons
document.querySelectorAll(".presets button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.preset) {
      customPortsInput.value = btn.dataset.preset;
    } else {
      startInput.value = btn.dataset.start;
      endInput.value = btn.dataset.end;
    }
  });
});

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

// Draw one square per port, then colour them in quickly from left to right
function drawGrid(count, openSet, portOf) {
  grid.innerHTML = "";
  grid.classList.remove("scanning");
  const cells = [];

  for (let i = 0; i < count; i++) {
    const port = portOf(i);
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.title = openSet.has(port) ? `Port ${port}: open` : `Port ${port}: closed or filtered`;
    grid.appendChild(cell);
    cells.push({ el: cell, open: openSet.has(port) });
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paint = (c) => c.el.classList.add(c.open ? "open" : "done");

  if (reduceMotion) return cells.forEach(paint);

  let i = 0;
  const perFrame = Math.max(1, Math.ceil(cells.length / 80));
  function tick() {
    for (let k = 0; k < perFrame && i < cells.length; k++) paint(cells[i++]);
    if (i < cells.length) requestAnimationFrame(tick);
  }
  tick();
}

function showResults(data) {
  document.getElementById("s-open").textContent = data.open_ports.length;
  document.getElementById("s-total").textContent = data.total_checked;
  document.getElementById("s-time").textContent = data.seconds;
  document.getElementById("s-ip").textContent = data.ip;
  summary.hidden = false;

  const openSet = new Set(data.open_ports.map((p) => p.port));
  const span = data.end - data.start + 1;
  if (span === data.total_checked) {
    // contiguous range: draw a full grid, one square per port in range
    drawGrid(span, openSet, (i) => data.start + i);
  } else {
    // custom list: one square per checked port only
    drawGrid(data.total_checked, openSet, (i) => data._sortedPorts[i]);
  }

  tableBody.innerHTML = "";
  data.open_ports.forEach((p) => {
    const tr = document.createElement("tr");
    const portTd = document.createElement("td");
    const serviceTd = document.createElement("td");
    const bannerTd = document.createElement("td");
    portTd.textContent = p.port;
    serviceTd.textContent = p.service || "unknown";
    bannerTd.textContent = p.banner || (data.scan_type === "service" ? "—" : "");
    bannerTd.title = p.banner || "";
    tr.append(portTd, serviceTd, bannerTd);
    tableBody.appendChild(tr);
  });
  table.hidden = data.open_ports.length === 0;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning…";
  showMessage("Checking ports. This can take a few seconds.");

  const portMode = document.querySelector('input[name="port_mode"]:checked').value;
  const scanType = document.querySelector('input[name="scan_type"]:checked').value;

  // placeholder pulsing grid while we wait
  grid.innerHTML = "";
  grid.classList.add("scanning");
  if (portMode === "range") {
    const s = parseInt(startInput.value, 10);
    const e = parseInt(endInput.value, 10);
    if (s > 0 && e >= s && e - s < 2000) {
      for (let p = s; p <= e; p++) {
        const c = document.createElement("div");
        c.className = "cell";
        grid.appendChild(c);
      }
    }
  } else {
    const n = customPortsInput.value.split(",").filter((x) => x.trim()).length;
    for (let i = 0; i < n; i++) {
      const c = document.createElement("div");
      c.className = "cell";
      grid.appendChild(c);
    }
  }

  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: targetInput.value,
        port_mode: portMode,
        scan_type: scanType,
        start: startInput.value,
        end: endInput.value,
        custom_ports: customPortsInput.value,
        timeout: timeoutInput.value,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      grid.innerHTML = "";
      grid.classList.remove("scanning");
      showMessage(data.error, true);
    } else {
      if (portMode === "custom") {
        data._sortedPorts = [...customPortsInput.value.split(",")]
          .map((x) => parseInt(x.trim(), 10))
          .filter((n) => !Number.isNaN(n))
          .sort((a, b) => a - b);
      }
      showResults(data);
      showMessage(`Done. Found ${data.open_ports.length} open port(s).`);
      loadHistory();
    }
  } catch (err) {
    grid.classList.remove("scanning");
    showMessage("Could not reach the server. Is app.py running?", true);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "Start scan";
  }
});

// Recent scans list (click one to reuse its target)
async function loadHistory() {
  try {
    const response = await fetch("/api/history");
    const rows = await response.json();
    if (rows.length === 0) return;

    historyList.innerHTML = "";
    rows.forEach((row) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${row.target} — ${row.ports_label}`;
      const small = document.createElement("small");
      small.textContent = `${row.scan_type}, ${row.open_count} open, ${row.seconds}s, ${row.scanned_at}`;
      btn.appendChild(small);
      btn.addEventListener("click", () => { targetInput.value = row.target; });
      li.appendChild(btn);
      historyList.appendChild(li);
    });
  } catch (err) {
    /* history is optional, ignore errors */
  }
}

loadHistory();
