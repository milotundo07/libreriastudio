export function normalizeIsbn(raw = "") {
  return String(raw).replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isValidIsbn10(raw) {
  const value = normalizeIsbn(raw);
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  const sum = [...value].reduce((total, char, index) => {
    const digit = char === "X" ? 10 : Number(char);
    return total + digit * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

export function isValidIsbn13(raw) {
  const value = normalizeIsbn(raw);
  if (!/^(978|979)\d{10}$/.test(value)) return false;
  const sum = [...value.slice(0, 12)].reduce(
    (total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  const check = (10 - (sum % 10)) % 10;
  return check === Number(value[12]);
}

export function validateIsbn(raw) {
  const value = normalizeIsbn(raw);
  if (value.length === 10) return { value, valid: isValidIsbn10(value), type: "ISBN-10" };
  if (value.length === 13) return { value, valid: isValidIsbn13(value), type: "ISBN-13" };
  return { value, valid: false, type: "" };
}

export function isbn10To13(raw) {
  const value = normalizeIsbn(raw);
  if (!isValidIsbn10(value)) return "";
  const core = `978${value.slice(0, 9)}`;
  const sum = [...core].reduce(
    (total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${core}${(10 - (sum % 10)) % 10}`;
}

export function isbn13To10(raw) {
  const value = normalizeIsbn(raw);
  if (!isValidIsbn13(value) || !value.startsWith("978")) return "";
  const core = value.slice(3, 12);
  const sum = [...core].reduce(
    (total, char, index) => total + Number(char) * (10 - index),
    0,
  );
  const remainder = 11 - (sum % 11);
  const check = remainder === 10 ? "X" : remainder === 11 ? "0" : String(remainder);
  return `${core}${check}`;
}

export function canonicalIsbn(raw) {
  const value = normalizeIsbn(raw);
  if (isValidIsbn13(value)) return value;
  if (isValidIsbn10(value)) return isbn10To13(value);
  return "";
}

export function isbnCandidates(raw) {
  const value = normalizeIsbn(raw);
  if (isValidIsbn13(value)) {
    const isbn10 = isbn13To10(value);
    return isbn10 ? [value, isbn10] : [value];
  }
  if (isValidIsbn10(value)) return [isbn10To13(value), value].filter(Boolean);
  return [];
}
