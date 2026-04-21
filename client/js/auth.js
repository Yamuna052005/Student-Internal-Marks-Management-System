import { api, setToken, setUser, getToken } from "./api.js";

/** Align API user shape (id / studentRef) with client code that expects _id / studentId. */
export function normalizeUser(u) {
  if (!u) return u;
  const rawId = u.id ?? u._id;
  const idStr = rawId != null ? String(rawId) : undefined;
  const profile = u.studentProfile && typeof u.studentProfile === "object" ? u.studentProfile : null;
  const ref = u.studentRef ?? u.studentId ?? profile?._id;
  let studentLink;
  let studentRefValue;
  if (profile?._id != null) {
    studentLink = String(profile._id);
    studentRefValue = { ...profile, _id: studentLink };
  } else if (ref && typeof ref === "object" && ref._id != null) {
    studentLink = String(ref._id);
    studentRefValue = { ...ref, _id: studentLink };
  } else if (ref != null) {
    studentLink = String(ref);
    studentRefValue = studentLink;
  }
  return {
    ...u,
    id: idStr,
    _id: idStr,
    ...(profile ? { studentProfile: { ...profile, _id: String(profile._id) } } : {}),
    ...(studentLink ? { studentRef: studentRefValue, studentId: studentLink } : {}),
  };
}

export async function login(username, password) {
  const data = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const nu = normalizeUser(data.user);
  setToken(data.token);
  setUser(nu);
  return nu;
}

export function logout() {
  setToken(null);
  setUser(null);
  window.location.replace("/");
}

export function requireAuth() {
  if (!getToken()) {
    window.location.replace("/");
    return false;
  }
  return true;
}

export function requireRoles(...roles) {
  const u = JSON.parse(localStorage.getItem("wsimms_user") || "null");
  if (!u || !roles.includes(u.role)) {
    window.location.href = "/pages/dashboard.html";
    return false;
  }
  return true;
}

export async function refreshMe() {
  const data = await api("/auth/me");
  if (data?.user) setUser(normalizeUser(data.user));
  return data?.user ? normalizeUser(data.user) : null;
}
