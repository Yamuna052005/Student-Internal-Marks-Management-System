import { api, setToken, setUser, getToken } from "./api.js";

/** Align API user shape (id / studentRef) with client code that expects _id / studentId. */
export function normalizeUser(u) {
  if (!u) return u;
  const rawId = u.id ?? u._id;
  const idStr = rawId != null ? String(rawId) : undefined;
  const ref = u.studentRef ?? u.studentId;
  let studentLink;
  if (ref && typeof ref === "object" && ref._id != null) {
    studentLink = String(ref._id);
  } else if (ref != null) {
    studentLink = String(ref);
  }
  return {
    ...u,
    id: idStr,
    _id: idStr,
    ...(studentLink ? { studentRef: studentLink, studentId: studentLink } : {}),
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
  window.location.href = "/index.html";
}

export function requireAuth() {
  if (!getToken()) {
    window.location.href = "/index.html";
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
