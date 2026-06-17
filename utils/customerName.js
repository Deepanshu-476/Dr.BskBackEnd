const getEmailLocalPart = (email = "") => String(email).split("@")[0]?.trim();

const isUsefulCustomerName = (name, email = "") => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  if (["null", "undefined", "customer", "guest"].includes(trimmed.toLowerCase())) return false;
  if (email && trimmed.toLowerCase() === getEmailLocalPart(email).toLowerCase()) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
  return true;
};

const pickCustomerName = (...candidates) => {
  for (const candidate of candidates) {
    const name = typeof candidate === "string" ? candidate : candidate?.name;
    const email = typeof candidate === "object" ? candidate?.email : "";
    if (isUsefulCustomerName(name, email)) {
      return String(name).trim();
    }
  }
  return "";
};

const resolveCustomerName = (email = "", ...candidates) => {
  return pickCustomerName(...candidates) || getEmailLocalPart(email) || "Customer";
};

module.exports = {
  getEmailLocalPart,
  isUsefulCustomerName,
  pickCustomerName,
  resolveCustomerName,
};
