// Reconstruct horizontal source lines from PDF.js text positions, without
// interpreting dates, descriptors, amounts, or statement totals here.
export function textLines(items) {
  const positioned = items.filter(item => typeof item.str === "string" && item.str.trim()).map(item => {
    if (!Array.isArray(item.transform) || item.transform.length !== 6 ||
        !item.transform.every(Number.isFinite) || !Number.isFinite(item.width)) {
      throw new Error("The PDF text positions could not be read.");
    }
    if (item.dir === "ttb" || Math.abs(item.transform[1]) > 0.1 || item.transform[0] <= 0) {
      throw new Error("Select a statement with upright, horizontal text.");
    }
    return { text: item.str, x: item.transform[4], y: item.transform[5], width: item.width,
      height: Math.hypot(item.transform[2], item.transform[3]) };
  }).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of positioned) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - item.y) <= 1) last.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map(line => {
    const parts = line.items.sort((a, b) => a.x - b.x);
    return parts.reduce((text, item, index) => {
      if (!index) return item.text;
      const previous = parts[index - 1];
      const gap = item.x - (previous.x + previous.width);
      const space = gap > Math.max(2, Math.min(item.height, previous.height) * 0.4) ? "  " :
        gap > 0.5 && !/\s$/.test(text) && !/^\s/.test(item.text) ? " " : "";
      return text + space + item.text;
    }, "").trim();
  });
}
