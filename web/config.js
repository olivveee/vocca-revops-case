// The Google Sheet is the back-office: data, cleaning rules, quota and thresholds live there.
// This page only reads three tabs published to the web as CSV
// (File > Share > Publish to web > select DEALS_CLEAN, RAW_team, WEB_PARAMS > CSV).
// publishedId is the "2PACX-..." part of the published link.
window.DASHBOARD_CONFIG = {
  publishedId: "2PACX-1vQKgran19SYSAw9I1BM68Jj6VYcLvR0ykDEV1zRW3aQJyCAAtTV7eQ8zExc-3j0gh6SJaV8jvUTh7xl",
  gids: { deals: 106, team: 1783399552, params: 107 },
  sheetUrl: "https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit",
};
