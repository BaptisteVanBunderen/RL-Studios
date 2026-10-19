// Import d'un fichier comme texte brut (Vite) : sert le SDK des overlays tel quel, sans chemin à
// résoudre dans l'application installée.
declare module '*?raw' {
  const content: string
  export default content
}
