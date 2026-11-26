import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

const adminLoading = document.querySelector("#admin-loading");
const adminLoadingMessage = document.querySelector("#admin-loading-message");
const adminLayout = document.querySelector("#admin-layout");
const dashboardMessage = document.querySelector("#dashboard-message");
const searchInput = document.querySelector('input[type="search"]');
const statusFilter = document.querySelector("#status-filter");
const applicationGroups = document.querySelector("#application-groups");
const applicationDialog = document.querySelector("#application-dialog");
const applicationDetails = document.querySelector("#application-details");
const programDialog = document.querySelector("#program-dialog");
const programForm = document.querySelector("#program-form");
const programMessage = document.querySelector("#program-message");
const saveProgramButton = document.querySelector("#save-program-button");

const requiredConfig = [SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY];
const configIsPresent = requiredConfig.every(
  (value) => value && !value.startsWith("YOUR_"),
);

let supabase;
let currentUser;
let applications = [];
let confirmedApplicants = []; // NEW
let programs = [];
let weekApplications = [];
let applicationCountsByProgram = new Map();
let totalApplicationCount = 0;
let pendingApplicationCount = 0;
let confirmedApplicationCount = 0;
let isLoading = false;
let isRedirectingToLogin = false;

function showAccessMessage(message, isError = false) {
  adminLoading.hidden = false;
  adminLayout.hidden = true;
  adminLoadingMessage.textContent = message;
  adminLoadingMessage.classList.toggle("error", isError);
}

function redirectToLogin() {
  if (isRedirectingToLogin) return;
  isRedirectingToLogin = true;
  window.location.replace(new URL("../index.html", import.meta.url).href);
}

function showDashboard() {
  adminLoading.hidden = true;
  adminLayout.hidden = false;
}

function setDashboardMessage(message, isError = false) {
  dashboardMessage.textContent = message;
  dashboardMessage.classList.toggle("error", isError);
}

function formatDate(value, options = { dateStyle: "medium", timeStyle: "short" }) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, options).format(date);
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function updateSummary() {
  const activePrograms = programs.filter(isAcceptingProgram);

  setText("#total-applications", String(totalApplicationCount));
  setText("#pending-applications", String(pendingApplicationCount));
  setText("#confirmed-applications", String(confirmedApplicationCount));
  setText("#active-program-count", String(activePrograms.length));
  setText("#pending-nav-count", String(pendingApplicationCount));
  setText("#current-date", new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date()));
  setText("#welcome-heading", `Good day, ${currentUser?.email ?? "Admin"}`);
  setText("#account-name", currentUser?.email ?? "Administrator");
  setText("#week-total", `${weekApplications.length} this week`);
}

function isAcceptingProgram(program) {
  const today = new Date().toISOString().slice(0, 10);
  return program.is_active && (!program.application_deadline || program.application_deadline >= today);
}

function renderChart() {
  const chart = document.querySelector("#applications-chart");
  chart.replaceChildren();

  const dayCounts = Array.from({ length: 7 }, () => 0);
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  for (const application of weekApplications) {
    if (!application.submitted_at) continue;
    const submitted = new Date(application.submitted_at);
    const dayIndex = Math.floor((submitted - monday) / 86400000);
    if (dayIndex >= 0 && dayIndex < 7) dayCounts[dayIndex] += 1;
  }

  const maxCount = Math.max(1, ...dayCounts);
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (let index = 0; index < dayCounts.length; index += 1) {
    const day = makeElement("div", "chart-day");
    const track = makeElement("div", "bar-track");
    const bar = document.createElement("span");
    bar.style.setProperty("--bar-height", `${dayCounts[index] === 0 ? 2 : (dayCounts[index] / maxCount) * 100}%`);
    track.append(bar);
    day.append(track, makeElement("small", "", dayNames[index]));
    chart.append(day);
  }
}

function renderPrograms() {
  const list = document.querySelector("#active-program-list");
  list.replaceChildren();
  const activePrograms = programs.filter(isAcceptingProgram);

  if (activePrograms.length === 0) {
    list.append(makeElement("p", "empty-message", "No active programs."));
    return;
  }

  for (const program of activePrograms) {
    const received = applicationCountsByProgram.get(program.id) ?? 0;
    const progress = program.slot_limit > 0
      ? Math.min(100, (received / program.slot_limit) * 100)
      : 0;
    const item = makeElement("div", "program-progress");
    const label = makeElement("div", "progress-label");
    label.append(
      makeElement("strong", "", program.name),
      makeElement("span", "", `${received} / ${program.slot_limit}`),
    );
    const track = makeElement("div", "progress-track");
    const bar = document.createElement("span");
    bar.style.setProperty("--progress", `${progress}%`);
    track.append(bar);
    item.append(label, track);
    // NEW: delete button
    const deleteButton = makeElement("button", "delete-program-button", "Delete program");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => deleteProgram(program, deleteButton));
    item.append(deleteButton);
    list.append(item);
  }
}

function renderApplications() {
  applicationGroups.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const selectedStatus = statusFilter.value;
  const filtered = applications.filter((application) => {
    const matchesQuery = application.applicant_name.toLocaleLowerCase().includes(query)
      || application.applicant_email.toLocaleLowerCase().includes(query);
    return matchesQuery && (selectedStatus === "all" || application.status === selectedStatus);
  });

  const programMap = new Map(programs.map((program) => [program.id, program]));
  const grouped = new Map();
  for (const application of filtered) {
    const list = grouped.get(application.program_id) ?? [];
    list.push(application);
    grouped.set(application.program_id, list);
  }

  if (filtered.length === 0) {
    applicationGroups.append(makeElement("p", "empty-message", "No applications match this search."));
    return;
  }

  for (const [programId, groupApplications] of grouped) {
    const program = programMap.get(programId);
    const group = makeElement("article", "application-group");
    const heading = makeElement("div", "group-heading");
    const dot = makeElement("span", `group-dot ${program?.category === "education" ? "purple-dot" : "blue-dot"}`);
    dot.setAttribute("aria-hidden", "true");
    const title = makeElement("div");
    title.append(
      makeElement("h4", "", program?.name ?? "Unknown program"),
      makeElement("p", "", program?.eligibility ?? ""),
    );
    heading.append(dot, title, makeElement("span", "applicant-count", `${groupApplications.length} ${groupApplications.length === 1 ? "applicant" : "applicants"}`));
    const tableHeading = makeElement("div", "table-heading");
    for (const label of ["Applicant", "Submitted", "Status"]) tableHeading.append(makeElement("span", "", label));
    tableHeading.append(makeElement("span", "sr-only", "Actions"));
    group.append(heading, tableHeading);

    groupApplications.forEach((application, index) => {
      group.append(renderApplicationRow(application, index + 1));
    });
    applicationGroups.append(group);
  }
}

function renderApplicationRow(application, rowNumber) {
  const row = makeElement("div", "application-row");
  const applicant = makeElement("div", "applicant-cell");
  const number = makeElement("span", "row-number", String(rowNumber));
  const identity = makeElement("span");
  identity.append(
    makeElement("strong", "", application.applicant_name),
    makeElement("small", "", `Application ${application.id.slice(0, 8)}`),
  );
  applicant.append(number, identity);

  const submitted = makeElement("span", "submitted", formatDate(application.submitted_at));
  const status = makeElement("span", `status-badge ${application.status}`, capitalize(application.status));
  const actions = makeElement("div", "row-actions");
  const viewButton = makeElement("button", "view-button", "◉ View");
  viewButton.type = "button";
  viewButton.addEventListener("click", () => showApplicationDetails(application));
  actions.append(viewButton);

  if (application.status === "pending") {
    const confirmButton = makeElement("button", "confirm-button", "✓ Confirm");
    confirmButton.type = "button";
    confirmButton.addEventListener("click", () => updateApplicationStatus(application, "confirmed", confirmButton));
    actions.append(confirmButton);
    const rejectButton = makeElement("button", "reject-button", "Reject");
    rejectButton.type = "button";
    rejectButton.addEventListener("click", () => updateApplicationStatus(application, "rejected", rejectButton));
    actions.append(rejectButton);
  }

  row.append(applicant, submitted, status, actions);
  return row;
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : "Unknown";
}

// ===== NEW: show the uploaded ID and signature (private bucket -> signed URLs) =====
function showApplicationFiles(application) {
  const files = [
    ["Valid government ID", application.id_path],
    ["Signature", application.signature_path],
  ];
  const section = makeElement("div", "detail-files");

  for (const [label, path] of files) {
    const box = makeElement("div", "detail-file");
    box.append(makeElement("p", "detail-file-label", label));
    section.append(box);

    if (!path) {
      box.append(makeElement("p", "detail-file-empty", "Not provided"));
      continue;
    }

    const status = makeElement("p", "detail-file-empty", "Loading…");
    box.append(status);
    supabase.storage
      .from("application-files")
      .createSignedUrl(path, 600)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          status.textContent = `Could not load file: ${error?.message ?? "unknown error"}`;
          return;
        }
        const link = document.createElement("a");
        link.href = data.signedUrl;
        link.target = "_blank";
        link.rel = "noopener";
        const image = document.createElement("img");
        image.className = "detail-file-image";
        image.src = data.signedUrl;
        image.alt = label;
        link.append(image);
        status.replaceWith(link);
      });
  }
  applicationDetails.append(section);
}
// ===== END NEW =====

function showApplicationDetails(application) {
  const program = programs.find((item) => item.id === application.program_id);
  applicationDetails.replaceChildren();
  applicationDetails.append(
    makeElement("p", "auth-eyebrow", "APPLICATION DETAILS"),
    makeElement("h2", "", application.applicant_name),
  );

  const details = [
    ["Program", program?.name ?? "Unknown program"],
    ["Email", application.applicant_email],
    // NEW: fields from the application form
    ["First name", application.first_name || "Not provided"],
    ["Middle name", application.middle_name || "Not provided"],
    ["Last name", application.last_name || "Not provided"],
    ["Age", application.age ?? "Not provided"],
    ["Sex", application.sex || "Not provided"],
    ["Complete address", application.address || "Not provided"],
    ["Phone", application.applicant_phone || "Not provided"],
    ["Status", capitalize(application.status)],
    ["Submitted", formatDate(application.submitted_at)],
  ];
  const list = makeElement("dl", "details-list");
  for (const [label, value] of details) {
    list.append(makeElement("dt", "", label), makeElement("dd", "", value));
  }
  applicationDetails.append(list);
  showApplicationFiles(application); // NEW: government ID + signature

  if (application.status === "pending") {
    const actions = makeElement("div", "dialog-actions");
    const confirmButton = makeElement("button", "confirm-button", "Confirm application");
    confirmButton.type = "button";
    confirmButton.addEventListener("click", async () => {
      if (await updateApplicationStatus(application, "confirmed", confirmButton)) applicationDialog.close();
    });
    const rejectButton = makeElement("button", "reject-button", "Reject");
    rejectButton.type = "button";
    rejectButton.addEventListener("click", async () => {
      if (await updateApplicationStatus(application, "rejected", rejectButton)) applicationDialog.close();
    });
    actions.append(confirmButton, rejectButton);
    applicationDetails.append(actions);
  }
  applicationDialog.showModal();
}

async function updateApplicationStatus(application, status, button, reviewerNotes = null) {
  button.disabled = true;
  setDashboardMessage("");
  const { error } = await supabase.rpc("review_application", {
    p_application_id: application.id,
    p_status: status,
    p_reviewer_notes: reviewerNotes,
  });

  if (error) {
    button.disabled = false;
    setDashboardMessage(`Could not ${status} application: ${error.message}`, true);
    return false;
  }

  await loadDashboard();
  setDashboardMessage(`Application ${status}.`);
  return true;
}

async function loadDashboard() {
  if (isLoading) return;
  const loadingUserId = currentUser?.id;
  if (!loadingUserId) return;
  isLoading = true;
  setDashboardMessage("Loading dashboard data…");
  applicationGroups.replaceChildren();
  applicationGroups.append(makeElement("p", "empty-message", "Loading applications…"));

  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const [programResult, applicationResult, totalResult, pendingResult, confirmedResult, weekResult] = await Promise.all([
      supabase
        .from("programs")
        .select("id,name,category,description,eligibility,requirements,application_deadline,slot_limit,is_active,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("applications")
        .select("id,program_id,applicant_name,applicant_email,applicant_phone,status,submitted_at,first_name,middle_name,last_name,age,sex,address,id_path,signature_path")
        .order("submitted_at", { ascending: false })
        .range(0, 499),
      supabase.from("applications").select("id", { count: "exact", head: true }),
      supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
      supabase
        .from("applications")
        .select("submitted_at")
        .gte("submitted_at", weekStart.toISOString())
        .lt("submitted_at", new Date(weekStart.getTime() + 7 * 86400000).toISOString()),
    ]);

    if (programResult.error) throw new Error(`Could not load programs: ${programResult.error.message}`);
    if (applicationResult.error) throw new Error(`Could not load applications: ${applicationResult.error.message}`);
    if (totalResult.error) throw new Error(`Could not count applications: ${totalResult.error.message}`);
    if (pendingResult.error) throw new Error(`Could not count pending applications: ${pendingResult.error.message}`);
    if (confirmedResult.error) throw new Error(`Could not count confirmed applications: ${confirmedResult.error.message}`);
    if (weekResult.error) throw new Error(`Could not load weekly application totals: ${weekResult.error.message}`);
    if (currentUser?.id !== loadingUserId) return;
    programs = programResult.data;
    applications = applicationResult.data.map((application) => ({
      ...application,
      // NEW: build the full name from the new fields if applicant_name is empty
      applicant_name: application.applicant_name
        || [application.first_name, application.middle_name, application.last_name].filter(Boolean).join(" ")
        || "Unnamed applicant",
      applicant_email: application.applicant_email || "",
    }));
    totalApplicationCount = totalResult.count ?? 0;
    pendingApplicationCount = pendingResult.count ?? 0;
    confirmedApplicationCount = confirmedResult.count ?? 0;
    weekApplications = weekResult.data ?? [];
    const activePrograms = programs.filter(isAcceptingProgram);
    const programCounts = await Promise.all(activePrograms.map((program) =>
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("program_id", program.id)
        .in("status", ["pending", "confirmed"]),
    ));
    for (let index = 0; index < programCounts.length; index += 1) {
      if (programCounts[index].error) {
        throw new Error(`Could not count applications for ${activePrograms[index].name}: ${programCounts[index].error.message}`);
      }
    }
    if (currentUser?.id !== loadingUserId) return;
    applicationCountsByProgram = new Map(
      activePrograms.map((program, index) => [program.id, programCounts[index].count ?? 0]),
    );
    updateSummary();
    renderPrograms();
    renderChart();
    renderApplications();
    await loadConfirmedApplicants(); // NEW
    setDashboardMessage("");
  } catch (error) {
    setDashboardMessage(error instanceof Error ? error.message : "Could not load dashboard data.", true);
    applicationGroups.replaceChildren(makeElement("p", "empty-message", "Dashboard data could not be loaded."));
  } finally {
    isLoading = false;
  }
}

// ===== NEW: list of confirmed applicants (names only) + PDF download =====
function formatApplicantListName(application) {
  const given = [application.first_name, application.middle_name].filter(Boolean).join(" ");
  if (application.last_name && given) return `${application.last_name}, ${given}`;
  return application.applicant_name || [given, application.last_name].filter(Boolean).join(" ") || "Unnamed applicant";
}

async function loadConfirmedApplicants() {
  const container = document.querySelector("#confirmed-list");
  try {
    const pageSize = 1000;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("applications")
        .select("id,applicant_name,first_name,middle_name,last_name")
        .eq("status", "confirmed")
        .order("id")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    confirmedApplicants = rows
      .map(formatApplicantListName)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    renderConfirmedApplicants();
  } catch (error) {
    container.replaceChildren(makeElement("p", "empty-message", `Could not load confirmed applicants: ${error.message}`));
  }
}

function renderConfirmedApplicants() {
  const container = document.querySelector("#confirmed-list");
  const total = confirmedApplicants.length;

  container.replaceChildren();
  setText("#confirmed-count", `${total} confirmed`);
  document.querySelector("#save-confirmed").disabled = total === 0;

  if (total === 0) {
    container.append(makeElement("p", "empty-message", "No confirmed applicants yet."));
    return;
  }

  const screenList = makeElement("ol", "confirmed-names");
  for (const name of confirmedApplicants) {
    screenList.append(makeElement("li", "", name));
  }
  container.append(screenList);
}

// Save a soft copy as a PDF file
document.querySelector("#save-confirmed").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing PDF…";

  try {
    const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const lineHeight = 8;
    const total = confirmedApplicants.length;
    const today = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date());

    doc.setFont("times", "bold");
    doc.setFontSize(18);
    doc.text("Confirmed Applicants", pageWidth / 2, margin, { align: "center" });
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    doc.text(`E-Ayuda - ${today} - ${total} total`, pageWidth / 2, margin + 7, { align: "center" });

    doc.setFontSize(12);
    let y = margin + 20;
    confirmedApplicants.forEach((name, index) => {
      const lines = doc.splitTextToSize(name, pageWidth - margin * 2 - 12);
      if (y + lines.length * lineHeight > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(`${index + 1}.`, margin + 8, y, { align: "right" });
      doc.text(lines, margin + 12, y);
      y += lines.length * lineHeight;
    });

    const pages = doc.getNumberOfPages();
    doc.setFontSize(9);
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.text(`Page ${page} of ${pages}`, pageWidth / 2, pageHeight - 10, { align: "center" });
    }

    doc.save(`confirmed-applicants-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (error) {
    setDashboardMessage(`Could not create PDF: ${error.message}`, true);
  } finally {
    button.textContent = label;
    button.disabled = confirmedApplicants.length === 0;
  }
});
// ===== END NEW =====

// ===== NEW: delete an active program =====
async function deleteProgram(program, button) {
  const received = applicationCountsByProgram.get(program.id) ?? 0;
  const warning = received > 0 ? `It has ${received} pending/confirmed application(s). ` : "";
  if (!window.confirm(`${warning}Delete "${program.name}"? This cannot be undone.`)) return;

  button.disabled = true;
  setDashboardMessage("");
  const { data, error } = await supabase
    .from("programs")
    .delete()
    .eq("id", program.id)
    .select("id");

  if (error) {
    button.disabled = false;
    // 23503 = the program still has applications linked to it
    if (error.code === "23503") {
      if (window.confirm(`"${program.name}" can't be deleted because applications are linked to it.\n\nClose it instead? It will be hidden from applicants and the applications are kept.`)) {
        await closeProgram(program, button);
      }
      return;
    }
    setDashboardMessage(`Could not delete program: ${error.message}`, true);
    return;
  }
  if (!data || data.length === 0) {
    button.disabled = false;
    setDashboardMessage("Nothing was deleted. Your account may be missing a delete policy on the programs table.", true);
    return;
  }

  await loadDashboard();
  setDashboardMessage("Program deleted.");
}

async function closeProgram(program, button) {
  button.disabled = true;
  const { data, error } = await supabase
    .from("programs")
    .update({ is_active: false })
    .eq("id", program.id)
    .select("id");

  if (error || !data || data.length === 0) {
    button.disabled = false;
    setDashboardMessage(error ? `Could not close program: ${error.message}` : "Could not close the program. Your account may be missing an update policy on the programs table.", true);
    return;
  }
  await loadDashboard();
  setDashboardMessage("Program closed. Its applications were kept.");
}
// ===== END NEW =====

async function verifyAdmin(user) {
  if (!user) {
    currentUser = undefined;
    redirectToLogin();
    return;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    showAccessMessage(`Could not verify admin access: ${error.message}`, true);
    return;
  }
  if (!data) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      showAccessMessage(`This account does not have administrator access, and sign-out failed: ${signOutError.message}`, true);
      return;
    }
    redirectToLogin();
    return;
  }

  currentUser = user;
  showDashboard();
  await loadDashboard();
}

document.querySelector("#create-program-button").addEventListener("click", () => {
  programForm.reset();
  programMessage.textContent = "";
  programDialog.showModal();
});

document.querySelector("#close-program").addEventListener("click", () => programDialog.close());

programForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(programForm);
  const requirements = String(formData.get("requirements"))
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  saveProgramButton.disabled = true;
  programMessage.textContent = "Creating program…";
  programMessage.classList.remove("error");

  const { error } = await supabase.from("programs").insert({
    name: String(formData.get("name")).trim(),
    category: String(formData.get("category")),
    description: String(formData.get("description")).trim(),
    eligibility: String(formData.get("eligibility")).trim(),
    requirements,
    application_deadline: String(formData.get("application_deadline")) || null,
    slot_limit: Number(formData.get("slot_limit")),
    is_active: true,
  });

  saveProgramButton.disabled = false;
  if (error) {
    programMessage.textContent = `Could not create program: ${error.message}`;
    programMessage.classList.add("error");
    return;
  }

  programDialog.close();
  await loadDashboard();
  setDashboardMessage("Program created.");
});

if (!configIsPresent) {
  showAccessMessage("Set your Supabase project URL and publishable key in js/supabase-config.js, then reload this page.", true);
} else {
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  supabase = supabaseClient;

  document.querySelector("#sign-out").addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setDashboardMessage(`Could not sign out: ${error.message}`, true);
      return;
    }
    applications = [];
    programs = [];
    redirectToLogin();
  });

  searchInput.addEventListener("input", renderApplications);
  statusFilter.addEventListener("change", renderApplications);
  document.querySelector("[data-filter-status='confirmed']").addEventListener("click", () => {
    statusFilter.value = "confirmed";
    renderApplications();
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      showAccessMessage(`Could not restore your session: ${error.message}`, true);
      return;
    }
    verifyAdmin(data.session?.user);
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      currentUser = undefined;
      redirectToLogin();
    }
  });
}