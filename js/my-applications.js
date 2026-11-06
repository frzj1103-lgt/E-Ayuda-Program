import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const list = document.querySelector("#my-applications-list");
const message = document.querySelector("#account-message");
if (new URLSearchParams(window.location.search).get("notice") === "admin-check-failed") {
  message.textContent = "Signed in, but administrator access could not be verified. You can still view your applications.";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderApplications(applications, programs) {
  list.replaceChildren();
  if (applications.length === 0) {
    list.append(element("p", "program-message", "You have not submitted any applications yet."));
    return;
  }

  const programMap = new Map(programs.map((program) => [program.id, program]));
  for (const application of applications) {
    const card = element("article", "my-application-card");
    const title = element("h2", "", programMap.get(application.program_id)?.name ?? "Assistance program");
    const status = element("span", `my-status ${application.status}`, application.status);
    const submitted = element("p", "", `Submitted ${formatDate(application.submitted_at)}`);
    card.append(title, status, submitted);
    list.append(card);
  }
}

async function loadMyApplications() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    message.textContent = `Could not restore sign-in: ${sessionError.message}`;
    return;
  }
  const user = sessionData.session?.user;
  if (!user) {
    document.querySelector("#account-intro").textContent = "Sign in to securely view your application status.";
    const link = element("a", "account-login-link", "Sign in");
    link.href = "../index.html";
    list.append(link);
    return;
  }

  document.querySelector("#account-sign-out").hidden = false;
  document.querySelector("#account-intro").textContent = `Signed in as ${user.email}`;
  const { data: applications, error: applicationError } = await supabase
    .from("applications")
    .select("id,program_id,status,submitted_at")
    .eq("applicant_user_id", user.id)
    .order("submitted_at", { ascending: false });

  if (applicationError) {
    message.textContent = `Could not load applications: ${applicationError.message}. Run the database setup for your new Supabase project.`;
    return;
  }

  const programIds = [...new Set(applications.map((application) => application.program_id))];
  let programs = [];
  if (programIds.length > 0) {
    const { data, error } = await supabase
      .from("programs")
      .select("id,name")
      .in("id", programIds);
    if (error) {
      message.textContent = `Could not load program names: ${error.message}`;
      return;
    }
    programs = data;
  }
  const { data: currentSession, error: currentSessionError } = await supabase.auth.getSession();
  if (currentSessionError) {
    message.textContent = `Could not verify your session: ${currentSessionError.message}`;
    return;
  }
  if (currentSession.session?.user.id !== user.id) {
    list.replaceChildren();
    document.querySelector("#account-intro").textContent = "Sign in to securely view your application status.";
    return;
  }
  renderApplications(applications, programs);
}

document.querySelector("#account-sign-out").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    message.textContent = `Could not sign out: ${error.message}`;
    return;
  }
  window.location.reload();
});

loadMyApplications();
