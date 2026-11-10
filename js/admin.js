import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

const authScreen = document.querySelector("#auth-screen");
const loginForm = document.querySelector("#login-form");
const loginSubmit = document.querySelector("#login-submit");
const authMessage = document.querySelector("#auth-message");
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
let programs = [];
let weekApplications = [];
let applicationCountsByProgram = new Map();
let totalApplicationCount = 0;
let pendingApplicationCount = 0;
let confirmedApplicationCount = 0;
let isLoading = false;

function showAuth(message = "") {
  authScreen.hidden = false;
  adminLayout.hidden = true;
  currentUser = undefined;
  applications = [];
  programs = [];
  weekApplications = [];
  applicationCountsByProgram = new Map();
  totalApplicationCount = 0;
  pendingApplicationCount = 0;
  confirmedApplicationCount = 0;
  applicationGroups.replaceChildren();
  document.querySelector("#active-program-list").replaceChildren();
  setText("#total-applications", "—");
  setText("#pending-applications", "—");
  setText("#confirmed-applications", "—");
  setText("#active-program-count", "—");
  authMessage.textContent = message;
}

function showDashboard() {
  authScreen.hidden = true;
  adminLayout.hidden = false;
}

function setAuthMessage(message, isError = true) {
  authMessage.textContent = message;
  authMessage.classList.toggle("error", isError);
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
    ["Phone", application.applicant_phone || "Not provided"],
    ["Status", capitalize(application.status)],
    ["Submitted", formatDate(application.submitted_at)],
    ["Reviewer notes", application.reviewer_notes || "No notes"],
  ];
  const list = makeElement("dl", "details-list");
  for (const [label, value] of details) {
    list.append(makeElement("dt", "", label), makeElement("dd", "", value));
  }
  applicationDetails.append(list);

  if (application.status === "pending") {
    const notesLabel = makeElement("label", "review-notes-label", "Private reviewer notes");
    notesLabel.htmlFor = "review-notes";
    const notesInput = makeElement("textarea", "review-notes-input");
    notesInput.id = "review-notes";
    notesInput.maxLength = 2000;
    notesInput.value = application.reviewer_notes ?? "";
    applicationDetails.append(notesLabel, notesInput);
    const actions = makeElement("div", "dialog-actions");
    const confirmButton = makeElement("button", "confirm-button", "Confirm application");
    confirmButton.type = "button";
    confirmButton.addEventListener("click", async () => {
      if (await updateApplicationStatus(application, "confirmed", confirmButton, notesInput.value)) applicationDialog.close();
    });
    const rejectButton = makeElement("button", "reject-button", "Reject");
    rejectButton.type = "button";
    rejectButton.addEventListener("click", async () => {
      if (await updateApplicationStatus(application, "rejected", rejectButton, notesInput.value)) applicationDialog.close();
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
    const [programResult, applicationResult, reviewResult, totalResult, pendingResult, confirmedResult, weekResult] = await Promise.all([
      supabase
        .from("programs")
        .select("id,name,category,description,eligibility,requirements,application_deadline,slot_limit,is_active,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("applications")
        .select("id,program_id,applicant_name,applicant_email,applicant_phone,status,submitted_at")
        .order("submitted_at", { ascending: false })
        .range(0, 499),
      supabase.from("application_reviews").select("application_id,reviewer_notes"),
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
    if (reviewResult.error) throw new Error(`Could not load private review notes: ${reviewResult.error.message}`);
    if (totalResult.error) throw new Error(`Could not count applications: ${totalResult.error.message}`);
    if (pendingResult.error) throw new Error(`Could not count pending applications: ${pendingResult.error.message}`);
    if (confirmedResult.error) throw new Error(`Could not count confirmed applications: ${confirmedResult.error.message}`);
    if (weekResult.error) throw new Error(`Could not load weekly application totals: ${weekResult.error.message}`);
    if (currentUser?.id !== loadingUserId) return;
    programs = programResult.data;
    const reviewNotes = new Map(
      reviewResult.data.map((review) => [review.application_id, review.reviewer_notes]),
    );
    applications = applicationResult.data.map((application) => ({
      ...application,
      reviewer_notes: reviewNotes.get(application.id) ?? null,
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
    setDashboardMessage("");
  } catch (error) {
    setDashboardMessage(error instanceof Error ? error.message : "Could not load dashboard data.", true);
    applicationGroups.replaceChildren(makeElement("p", "empty-message", "Dashboard data could not be loaded."));
  } finally {
    isLoading = false;
  }
}

async function verifyAdmin(user) {
  if (!user) {
    currentUser = undefined;
    showAuth();
    return;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    showAuth(`Could not verify admin access: ${error.message}`);
    return;
  }
  if (!data) {
    await supabase.auth.signOut();
    showAuth("This account does not have active administrator access.");
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
  showAuth("Set your Supabase project URL and publishable key in js/supabase-config.js, then reload this page.");
  loginSubmit.disabled = true;
} else {
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  supabase = supabaseClient;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginSubmit.disabled = true;
    setAuthMessage("Signing in…", false);
    const formData = new FormData(loginForm);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email")).trim(),
      password: String(formData.get("password")),
    });

    loginSubmit.disabled = false;
    if (error) {
      setAuthMessage(`Sign-in failed: ${error.message}`);
      return;
    }

    setAuthMessage("");
    await verifyAdmin(data.user);
  });

  document.querySelector("#sign-out").addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setDashboardMessage(`Could not sign out: ${error.message}`, true);
      return;
    }
    applications = [];
    programs = [];
    showAuth();
  });

  searchInput.addEventListener("input", renderApplications);
  statusFilter.addEventListener("change", renderApplications);
  document.querySelector("[data-filter-status='confirmed']").addEventListener("click", () => {
    statusFilter.value = "confirmed";
    renderApplications();
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      showAuth(`Could not restore your session: ${error.message}`);
      return;
    }
    verifyAdmin(data.session?.user);
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      currentUser = undefined;
      showAuth();
    }
  });
}