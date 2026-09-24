/**
 * Historique linéaire d'états (annuler / rétablir). Enregistrer un nouvel
 * état après un retour arrière efface la branche "rétablir", comme dans
 * n'importe quel éditeur. Les états identiques consécutifs sont ignorés.
 */
export class History<T> {
  private states: T[];
  private index = 0;

  constructor(
    initial: T,
    private readonly equals: (a: T, b: T) => boolean,
    private readonly limit = 100,
  ) {
    this.states = [initial];
  }

  get current(): T {
    return this.states[this.index];
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.states.length - 1;
  }

  /** Ajoute `state` comme nouvel état courant. Retourne false s'il est identique au courant. */
  record(state: T): boolean {
    if (this.equals(state, this.current)) {
      return false;
    }
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(state);
    if (this.states.length > this.limit) {
      this.states.shift();
    }
    this.index = this.states.length - 1;
    return true;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.index -= 1;
    return this.current;
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.index += 1;
    return this.current;
  }
}
