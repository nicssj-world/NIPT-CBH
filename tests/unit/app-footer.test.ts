import {it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {AppFooter} from "../../src/components/app-footer";
it("footer carries the copyright line and the release version, bottom-right",()=>{
 const html=renderToStaticMarkup(createElement(AppFooter));
 expect(html).toContain("© 2026 Chonburi Hospital — Medical Technology Department.");
 expect(html).toContain("v. 1.1.3");
 expect(renderToStaticMarkup(createElement(AppFooter,{floating:true}))).toContain("app-footer-floating");
});
