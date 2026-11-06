import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const programPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getMainPageUrl() {
  return new URL("../pages/Home.html", import.meta.url);
}

function getLoginUrl() {
  return new URL("../index.html", import.meta.url);
}

async function redirectAfterSignIn(user, feedback) {
  const { data: adminMembership, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    showFeedback(feedback, `Signed in, but administrator access could not be checked: ${error.message}`, true);
    return;
  }

  if (adminMembership) {
    window.location.href = new URL("../pages/admin.html", import.meta.url).href;
    return;
  }

  const programId = new URLSearchParams(window.location.search).get("program");
  if (programId && programPattern.test(programId)) {
    const mainPageUrl = getMainPageUrl();
    mainPageUrl.searchParams.set("apply", programId);
    window.location.href = mainPageUrl.href;
    return;
  }

  window.location.href = getMainPageUrl().href;
}

for (const toggle of document.querySelectorAll(".toggle-password")) {
  toggle.addEventListener("click", () => {
    const input = toggle.parentElement?.querySelector('input[type="password"], input[type="text"]');
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
    toggle.classList.toggle("ri-eye-off-line", input.type === "password");
    toggle.classList.toggle("ri-eye-line", input.type === "text");
  });
}

function showFeedback(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", isError);
}

const signupForm = document.querySelector("#signup-form");
if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector("#signup-submit");
    const feedback = document.querySelector("#auth-feedback");
    const formData = new FormData(signupForm);
    const fullName = String(formData.get("full_name")).trim();
    const email = String(formData.get("email")).trim();
    const password = String(formData.get("password"));
    if (fullName.length < 2 || !emailPattern.test(email) || password.length < 8) {
      showFeedback(feedback, "Enter a valid name, email, and password with at least 8 characters.", true);
      return;
    }

    submit.disabled = true;
    showFeedback(feedback, "Creating your account…");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: getLoginUrl().href,
      },
    });
    submit.disabled = false;

    if (error) {
      showFeedback(feedback, `Account creation failed: ${error.message}`, true);
      return;
    }

    if (data.session) {
      await redirectAfterSignIn(data.session.user, feedback);
      return;
    }

    signupForm.reset();
    showFeedback(feedback, "Account created. Check your email to confirm the account, then sign in.");
  });
}

const loginForm = document.querySelector("#login-form");
if (loginForm) {
  const resetForm = document.querySelector("#password-reset-form");
  const feedback = document.querySelector("#auth-feedback");
  const resetFeedback = document.querySelector("#reset-feedback");
  const recoveryMode = new URLSearchParams(window.location.search).has("recovery")
    || window.location.hash.includes("type=recovery");

  if (recoveryMode) {
    loginForm.hidden = true;
    resetForm.hidden = false;
    document.querySelector("#auth-title").textContent = "Choose a new password";
    document.querySelector("#auth-description").textContent = "Set a new password for your E-Ayuda account.";
    document.querySelector(".signup-text").hidden = true;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type="submit"]');
    const formData = new FormData(loginForm);
    submit.disabled = true;
    showFeedback(feedback, "Signing in…");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email")).trim(),
      password: String(formData.get("password")),
    });
    submit.disabled = false;

    if (error) {
      showFeedback(feedback, `Sign-in failed: ${error.message}`, true);
      return;
    }

    await redirectAfterSignIn(data.user, feedback);
  });

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = resetForm.querySelector('button[type="submit"]');
    const password = String(new FormData(resetForm).get("password"));
    if (password.length < 8) {
      showFeedback(resetFeedback, "Use a password with at least 8 characters.", true);
      return;
    }
    submit.disabled = true;
    showFeedback(resetFeedback, "Updating password…");
    const { error } = await supabase.auth.updateUser({ password });
    submit.disabled = false;
    if (error) {
      showFeedback(resetFeedback, `Could not update password: ${error.message}`, true);
      return;
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      showFeedback(resetFeedback, `Password updated, but sign-in could not be restored: ${sessionError.message}`, true);
      return;
    }
    if (sessionData.session?.user) {
      await redirectAfterSignIn(sessionData.session.user, resetFeedback);
    } else {
      window.location.href = getLoginUrl().href;
    }
  });

  if (!recoveryMode) {
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        showFeedback(feedback, `Could not restore your sign-in: ${error.message}`, true);
        return;
      }
      if (data.session?.user) await redirectAfterSignIn(data.session.user, feedback);
    });
  }
}

const forgotForm = document.querySelector("#forgot-password-form");
if (forgotForm) {
  forgotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = document.querySelector("#auth-feedback");
    const submit = forgotForm.querySelector('button[type="submit"]');
    const email = String(new FormData(forgotForm).get("email") ?? document.querySelector("#email").value).trim();
    if (!emailPattern.test(email)) {
      showFeedback(feedback, "Enter a valid email address.", true);
      return;
    }
    submit.disabled = true;
    showFeedback(feedback, "Sending reset instructions…");
    const redirectTo = getLoginUrl();
    redirectTo.searchParams.set("recovery", "1");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo.href });
    submit.disabled = false;
    if (error) {
      showFeedback(feedback, `Could not send reset instructions: ${error.message}`, true);
      return;
    }
    showFeedback(feedback, "If an account exists for that email, password reset instructions have been sent.");
  });
}
