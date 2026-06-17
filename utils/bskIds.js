const generateBskId = (prefix) => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BSK-${prefix}-${date}-${suffix}`;
};

module.exports = { generateBskId };
