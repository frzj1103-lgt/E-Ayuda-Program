import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const cardsElement = document.querySelector("#program-cards");
const programMessage = document.querySelector("#program-message");
const programCount = document.querySelector("#program-count");
const applyDialog = document.querySelector("#apply-dialog");
const applyForm = document.querySelector("#apply-form");
const applyMessage = document.querySelector("#apply-message");
const submitButton = document.querySelector("#submit-application");
let programs = [];
let selectedCategory = "all";
let selectedProgram;

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDeadline(value) {
  if (!value) return "No deadline listed";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Deadline not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function categoryKey(value) {
  const category = String(value ?? "").toLowerCase();
  if (category.includes("food")) return "food";
  if (category.includes("education") || category.includes("school")) return "education";
  if (category.includes("financial") || category.includes("cash")) return "financial";
  return "other";
}

function renderPrograms() {
  cardsElement.replaceChildren();
  const today = new Date().toISOString().slice(0, 10);
  const visiblePrograms = programs.filter((program) => {
    const accepting = program.is_active && (!program.application_deadline || program.application_deadline >= today);
    return accepting && (selectedCategory === "all" || categoryKey(program.category) === selectedCategory);
  });

  if (visiblePrograms.length === 0) {
    cardsElement.append(createElement("p", "program-message", "No programs are currently available in this category."));
    return;
  }

  for (const program of visiblePrograms) {
    const card = createElement("article", "program-card");
    const top = createElement("div", "program-top");
    const categoryLabel = categoryKey(program.category) === "other"
      ? String(program.category).toUpperCase()
      : `${categoryKey(program.category).toUpperCase()} ASSISTANCE`;
    top.append(
      createElement("span", "program-tag", categoryLabel),
      createElement("span", "slots", `${program.slot_limit} slots`),
    );
    const title = createElement("h3", "", program.name);
    const description = createElement("p", "program-description", program.description);
    const eligibility = createElement("div", "eligibility-box");
    eligibility.append(
      createElement("span", "mini-icon", "◌"),
      createElement("span", "eligibility-title", "Who can apply"),
      createElement("span", "muted", program.eligibility),
    );
    const deadline = createElement("div", "meta-row");
    deadline.append(
      createElement("span", "meta-icon", "◷"),
      createElement("span", "", "Application deadline"),
      createElement("strong", "", formatDeadline(program.application_deadline)),
    );
    const requirements = createElement("ul", "requirement-list");
    for (const requirement of program.requirements ?? []) {
      requirements.append(createElement("li", "", requirement));
    }

    const button = createElement("button", "apply-btn", "Apply for this program →");
    button.type = "button";
    button.addEventListener("click", () => openApplication(program));
    card.append(top, title, description, eligibility, deadline, requirements, button);
    cardsElement.append(card);
  }
}

function setMessage(message, isError = false) {
  programMessage.textContent = message;
  programMessage.classList.toggle("error-message", isError);
}

async function loadPrograms() {
  setMessage("");
  const { data, error } = await supabase
    .from("programs")
    .select("id,name,category,description,eligibility,requirements,application_deadline,slot_limit,is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    programCount.textContent = "Programs unavailable";
    cardsElement.replaceChildren(createElement("p", "program-message", "Programs could not be loaded."));
    setMessage(`Could not load programs: ${error.message}`, true);
    return;
  }

  programs = data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const acceptingCount = programs.filter((program) =>
    program.is_active && (!program.application_deadline || program.application_deadline >= today),
  ).length;
  programCount.textContent = `${acceptingCount} active ${acceptingCount === 1 ? "program" : "programs"}`;
  renderPrograms();
}

async function openApplication(program) {
  selectedProgram = program;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    setMessage(`Could not verify sign-in: ${error.message}`, true);
    return;
  }
  if (!data.session) {
    const loginUrl = new URL("../index.html", window.location.href);
    loginUrl.searchParams.set("program", program.id);
    window.location.href = loginUrl.href;
    return;
  }

  const profileName = data.session.user.user_metadata?.full_name ?? "";
  document.querySelector("#apply-program-name").textContent = program.name;
  document.querySelector("#apply-account").textContent = `Applying as ${data.session.user.email}`;
  document.querySelector("#applicant-name").value = profileName;
  document.querySelector("#applicant-phone").value = "";
  document.querySelector("#apply-message").textContent = "Your email is taken from your signed-in account.";
  applyDialog.showModal();
}

document.querySelector("#close-apply").addEventListener("click", () => applyDialog.close());

for (const tab of document.querySelectorAll(".filter-tabs .tab")) {
  tab.addEventListener("click", () => {
    selectedCategory = tab.dataset.category;
    for (const item of document.querySelectorAll(".filter-tabs .tab")) {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    }
    renderPrograms();
  });
}

applyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProgram) return;

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) {
    applyMessage.textContent = `Could not verify sign-in: ${sessionResult.error.message}`;
    return;
  }
  if (!sessionResult.data.session) {
    applyMessage.textContent = "Your session expired. Sign in again to submit your application.";
    return;
  }
  const applicantName = document.querySelector("#applicant-name").value.trim();
  if (applicantName.length < 2) {
    applyMessage.textContent = "Enter your full name.";
    return;
  }
  const phone = document.querySelector("#applicant-phone").value.trim();
  if (phone.length < 5) {
    applyMessage.textContent = "Please enter a valid phone number.";
    return;
  }

  submitButton.disabled = true;
  applyMessage.textContent = "Submitting your application…";
  const { error } = await supabase.rpc("submit_application", {
    p_program_id: selectedProgram.id,
    p_applicant_name: applicantName,
    p_applicant_phone: phone,
  });
  submitButton.disabled = false;

  if (error) {
    applyMessage.textContent = `Could not submit application: ${error.message}`;
    return;
  }

  applyDialog.close();
  applyForm.reset();
  setMessage("Application submitted. Sign in to your account to track its status.");
}
);

async function initializeHomePage() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    programCount.textContent = "Sign-in could not be verified";
    setMessage(`Could not verify sign-in: ${error.message}`, true);
    return;
  }
  if (!data.session) {
    const loginUrl = new URL("../index.html", window.location.href);
    const programId = new URLSearchParams(window.location.search).get("apply");
    if (programId) loginUrl.searchParams.set("program", programId);
    window.location.replace(loginUrl.href);
    return;
  }

  const programToApply = new URLSearchParams(window.location.search).get("apply");
  if (programToApply) {
    window.history.replaceState({}, "", window.location.pathname);
    await loadPrograms();
    const program = programs.find((item) => item.id === programToApply);
    if (program) await openApplication(program);
    return;
  }
  await loadPrograms();
}

initializeHomePage();