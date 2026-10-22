// Dependency-free so browser bundles (forms that validate money) can import it without dragging in node:sqlite.
export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}
