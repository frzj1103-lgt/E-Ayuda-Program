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

// ===== NEW: signature pad + file upload helpers =====
const signatureCanvas = document.querySelector("#signature-canvas");
const signatureContext = signatureCanvas.getContext("2d");
let isDrawing = false;
let hasDrawn = false;

function clearSignature() {
  signatureContext.fillStyle = "#fff";
  signatureContext.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  signatureContext.strokeStyle = "#000";
  signatureContext.lineWidth = 2.5;
  signatureContext.lineCap = "round";
  hasDrawn = false;
}
clearSignature();

function signaturePoint(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * signatureCanvas.width) / rect.width,
    y: ((event.clientY - rect.top) * signatureCanvas.height) / rect.height,
  };
}

signatureCanvas.addEventListener("pointerdown", (event) => {
  isDrawing = true;
  const { x, y } = signaturePoint(event);
  signatureContext.beginPath();
  signatureContext.moveTo(x, y);
});
signatureCanvas.addEventListener("pointermove", (event) => {
  if (!isDrawing) return;
  const { x, y } = signaturePoint(event);
  signatureContext.lineTo(x, y);
  signatureContext.stroke();
  hasDrawn = true;
});
signatureCanvas.addEventListener("pointerup", () => { isDrawing = false; });
signatureCanvas.addEventListener("pointerleave", () => { isDrawing = false; });
document.querySelector("#clear-signature").addEventListener("click", clearSignature);

function updateSignatureMode() {
  const mode = document.querySelector('input[name="signature-mode"]:checked').value;
  document.querySelector("#signature-draw-box").hidden = mode !== "draw";
  document.querySelector("#signature-upload-box").hidden = mode !== "upload";
}
for (const radio of document.querySelectorAll('input[name="signature-mode"]')) {
  radio.addEventListener("change", updateSignatureMode);
}

async function uploadFile(file, userId, label) {
  const extension = file.name ? file.name.split(".").pop() : "png";
  const path = `${userId}/${crypto.randomUUID()}-${label}.${extension}`;
  const { error } = await supabase.storage.from("application-files").upload(path, file);
  if (error) throw error;
  return path;
}
// ===== END NEW =====

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
  // OLD (replaced by the new fields below):
  // document.querySelector("#applicant-name").value = profileName;
  // document.querySelector("#applicant-phone").value = "";
  // NEW: reset the form, then fill in the email
  applyForm.reset();
  clearSignature();
  updateSignatureMode();
  document.querySelector("#applicant-email").value = data.session.user.email ?? "";
  document.querySelector("#apply-message").textContent = "Your email is taken from your signed-in account.";
  applyDialog.showModal();
}

document.querySelector("#close-apply").addEventListener("click", () => applyDialog.close());

const signOutButton = document.querySelector("#home-sign-out");
signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  const { error } = await supabase.auth.signOut();
  signOutButton.disabled = false;
  if (error) {
    setMessage(`Could not sign out: ${error.message}`, true);
    return;
  }
  window.location.replace(new URL("../index.html", import.meta.url).href);
});

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

// ===== OLD submit handler (kept for reference, replaced by the new one below) =====
/*
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
*/

// ===== NEW: submit handler with the full application form =====
applyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProgram) return;

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) {
    applyMessage.textContent = `Could not verify sign-in: ${sessionResult.error.message}`;
    return;
  }
  const session = sessionResult.data.session;
  if (!session) {
    applyMessage.textContent = "Your session expired. Sign in again to submit your application.";
    return;
  }

  const firstName = document.querySelector("#applicant-first-name").value.trim();
  const middleName = document.querySelector("#applicant-middle-name").value.trim();
  const lastName = document.querySelector("#applicant-last-name").value.trim();
  const age = Number(document.querySelector("#applicant-age").value);
  const sex = document.querySelector("#applicant-sex").value;
  const address = document.querySelector("#applicant-address").value.trim();
  const idFile = document.querySelector("#applicant-id-file").files[0];
  const signatureMode = document.querySelector('input[name="signature-mode"]:checked').value;
  const signatureFile = document.querySelector("#signature-file").files[0];

  if (firstName.length < 2 || lastName.length < 2) {
    applyMessage.textContent = "Enter your first and last name.";
    return;
  }
  if (!Number.isInteger(age) || age < 1 || age > 120) {
    applyMessage.textContent = "Enter a valid age.";
    return;
  }
  if (!sex) {
    applyMessage.textContent = "Select your sex.";
    return;
  }
  if (address.length < 10) {
    applyMessage.textContent = "Enter your complete address.";
    return;
  }
  if (!idFile) {
    applyMessage.textContent = "Upload a photo of your valid government ID.";
    return;
  }
  if (signatureMode === "draw" && !hasDrawn) {
    applyMessage.textContent = "Please draw your signature.";
    return;
  }
  if (signatureMode === "upload" && !signatureFile) {
    applyMessage.textContent = "Upload a photo of your signature.";
    return;
  }

  submitButton.disabled = true;
  applyMessage.textContent = "Submitting your application…";

  try {
    const userId = session.user.id;
    const idPath = await uploadFile(idFile, userId, "gov-id");
    const signature = signatureMode === "draw"
      ? await new Promise((resolve) => signatureCanvas.toBlob(resolve, "image/png"))
      : signatureFile;
    const signaturePath = await uploadFile(signature, userId, "signature");

    const { error } = await supabase.rpc("submit_application", {
      p_program_id: selectedProgram.id,
      p_first_name: firstName,
      p_middle_name: middleName || null,
      p_last_name: lastName,
      p_age: age,
      p_sex: sex,
      p_address: address,
      p_id_path: idPath,
      p_signature_path: signaturePath,
    });
    if (error) throw error;
  } catch (error) {
    submitButton.disabled = false;
    applyMessage.textContent = `Could not submit application: ${error.message}`;
    return;
  }

  submitButton.disabled = false;
  applyDialog.close();
  applyForm.reset();
  clearSignature();
  updateSignatureMode();
  setMessage("Application submitted. Sign in to your account to track its status.");
});
// ===== END NEW =====

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