// extension/background.js
// Makes clicking the toolbar icon open the persistent side panel
// instead of the old popup that closed on every outside click.
// chrome.sidePanel doesn't exist in Firefox (it uses sidebar_action instead),
// so this must be guarded to avoid throwing on install there.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});
