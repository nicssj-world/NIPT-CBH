/** Shown at the bottom-right of every page (owner request 2026-11-03). The version is the release the hospital sees, not package.json's. */
export const APP_VERSION="1.1.3";
export function AppFooter({floating=false}:{floating?:boolean}){
 return <footer className={floating?"app-footer app-footer-floating":"app-footer"}><span>© 2026 Chonburi Hospital — Medical Technology Department.</span><span className="app-footer-version">v. {APP_VERSION}</span></footer>;
}
