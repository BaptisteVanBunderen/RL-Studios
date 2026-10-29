export type Unsubscribe = () => void

/**
 * Petit émetteur d'événements typé. Un abonné qui plante ne doit ni empêcher les autres de
 * recevoir la valeur, ni remonter l'erreur à l'émetteur : elle est affichée et on continue.
 */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>()

  /** S'abonne ; renvoie la fonction pour se désabonner. */
  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value)
      } catch (error) {
        console.error('Emitter : erreur dans un abonné', error)
      }
    }
  }
}
