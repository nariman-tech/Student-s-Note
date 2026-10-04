import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

// Регистрация по email+паролю. Возвращает true, если сессия появилась сразу
// (email-подтверждение выключено в настройках Supabase), false — если нужно
// сначала подтвердить почту по ссылке и только потом входить паролем.
export async function signUpWithPassword(email: string, password: string): Promise<boolean> {
  // emailRedirectTo — чтобы ссылка из письма вела туда, где открыто приложение, а не на Site URL
  // из настроек Supabase (по умолчанию там localhost:3000, и ссылка открывает пустую страницу).
  // Адрес должен быть в Authentication → URL Configuration → Redirect URLs.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return !!data.session;
}

// Повторно отправить письмо с подтверждением — если первое не пришло или ссылка устарела
export async function resendConfirmation(email: string) {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

// Supabase отвечает по-английски — переводим частые ошибки, остальные показываем как есть
export function authErrorMessage(err: any): string {
  const code: string = err?.code ?? "";
  const msg: string = err?.message ?? "";
  if (code === "email_not_confirmed" || /email not confirmed/i.test(msg))
    return "Почта ещё не подтверждена. Откройте ссылку из письма (проверьте папку «Спам») или отправьте письмо ещё раз.";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg))
    return "Неверная почта или пароль.";
  if (code === "user_already_exists" || /already registered/i.test(msg))
    return "Такая почта уже зарегистрирована — войдите во вкладке «Войти».";
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(msg))
    return "Слишком много писем за короткое время. Подождите немного и попробуйте снова.";
  if (code === "same_password" || /should be different from the old/i.test(msg))
    return "Новый пароль должен отличаться от старого.";
  if (code === "weak_password" || /password should be/i.test(msg))
    return "Слишком простой пароль — минимум 6 символов.";
  if (code === "signup_disabled" || /signups not allowed/i.test(msg))
    return "Регистрация новых пользователей сейчас закрыта.";
  if (/provider is not enabled/i.test(msg))
    return "Вход через Google пока не настроен. Войдите по почте и паролю.";
  return msg || "Что-то пошло не так. Попробуйте ещё раз.";
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// Google — единственный соцвход, который Supabase поддерживает "из коробки" без доп. настройки
// на стороне провайдера, кроме самого Google. ВКонтакте и Mail.ru в стандартном списке Supabase
// нет — их можно подключить через Custom OAuth/OIDC Providers (до 3 своих провайдеров на проект),
// но там нужны свои client_id/secret и OAuth-эндпоинты этих сервисов — отдельная настройка.
// См. https://supabase.com/docs/guides/auth/custom-oauth-providers
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

// Письмо со ссылкой для сброса пароля. Ссылка ведёт обратно в приложение
// (адрес должен быть в Authentication → URL Configuration → Redirect URLs)
export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) throw error;
}

export async function setNewPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// isRecovery — пользователь пришёл по ссылке «сбросить пароль» из письма: нужно показать
// экран нового пароля, а не пускать сразу в приложение
export function onAuthStateChange(callback: (session: Session | null, isRecovery: boolean) => void) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(session, event === "PASSWORD_RECOVERY"));
  return () => data.subscription.unsubscribe();
}

// При первом входе строки в profiles ещё нет — создаём её здесь, а не в SQL-триггере,
// чтобы не усложнять MVP-схему серверными функциями
export async function ensureProfile(userId: string, email: string | undefined) {
  const { error } = await supabase.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });
  if (error) throw error;
}
