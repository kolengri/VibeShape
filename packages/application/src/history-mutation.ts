export function matchesHistoryOperation(type: string, operation: "move" | "insert") {
  return operation === "move"
    ? type === "org.vibeshape.history.item-moved"
    : type === "org.vibeshape.history.feature-inserted" ||
        type === "org.vibeshape.history.sketch-inserted"
}
