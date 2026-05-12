function doPost(e: GoogleAppsScript.Events.DoPost) {
  const syncData = JSON.parse(e.postData.contents);
  
  return ContentService.createTextOutput(JSON.stringify(syncTasks(syncData)))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify(syncTasks()))
    .setMimeType(ContentService.MimeType.JSON);
}
