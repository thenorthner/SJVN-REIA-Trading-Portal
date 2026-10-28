// REIA beta build: the public face shows the REIA desk alone. Set
// VITE_REIA_BETA=1 at build time and "/" (signed out) opens the REIA beta home
// and the sign-in screen carries no mark of the other desks. /reia-beta always
// opens that home, flag or not, and links to /login?desk=REIA.
export const REIA_BETA = import.meta.env.VITE_REIA_BETA === '1';
export const REIA_BETA_HOME = '/reia-beta';
export const REIA_BETA_TITLE = 'SJVN Limited | REIA Commercial Portal';
