// ניהול הזמנות — Supabase config
// Publishable Key בטוח לשימוש בדפדפן. אין לשים כאן service_role או secret key.
const productionConfig = {
  url: "https://bupoidcurcxuypfrjqio.supabase.co",
  publishableKey: "sb_publishable_Pc5sq8ItV9RefX6v5J9phg_jt2QH7os"
};
const host = globalThis.location?.hostname || '';
const trusted = !host || ['bargig-furniture.com', 'bargig-orders.pages.dev', 'bargig-kupa.pages.dev', 'orders.bargig-furniture.com', 'kupa.bargig-furniture.com', 'localhost', '127.0.0.1'].includes(host);
// A production payload accidentally published as a preview cannot open production cloud data.
export const supabaseConfig = Object.freeze(trusted ? productionConfig : {url:'', publishableKey:''});
