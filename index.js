/*

  This POC application is able to monitor up to 50 URLs (this is the max subrequests allowed on a worker)
  The worker is set to run on a cron schedule of 1 minute intervals. Each time this schedule happens the 
  worker does the following :-
  1. Loads all the monitors
  2. Checks each monitor to see if the elapsed frequency has passed since the previous attempt
  3. If the frequency has passed a fetch() is done against the URL
  4. The result of the fetch (200 == success anything else is a fail) is written to the status object.
  5. For fails notifications are sent to the user via the email address provided.
  6. If the monitor recovers subsequently a recovery notifcation is sent to the email address.

  The very basic UI provided allows the following functionality :-
  1. A home page provides links to the other pages.
  2. A status page displays the current status of all the monitors in a tabulated format
  3. A page allows new monitors to be added
  4. A page lists all the current monitors configured.
  5. Execute Manual Check allows the 
  

  Seperate KV objects are stored for each URL that needs to be checked, the format of this is shown below.
  The name of the KV is the same as the url_to_monitor. The frequency is how often a monitor gets checked
  The alert-email is who should be sent a notification if the address becomes unavialable. 
  {
    "url_to_monitor" : "https://google.com",
    "frequency" : "60",
    "alert-email" : "tim@newtonsoftware.net"
  }

  status object used to hold the results of the checks, as single status object holds all the results. :
  {
    "urls" : ["name" : "https://google.com",
    "last_failed" : "1634243688666"  // from Date.now() in javascript, ie. milliseconds from the epoch.
    "last_success" : "1634243688666"  // from Date.now() in javascript, ie. milliseconds from the epoch.
  }


*/

let _status = null; // set status so we can access this from multiple functions and we dont need to keep getting it from KV

addEventListener('scheduled', event => {
  event.waitUntil(cronEvent(event.cron))
})

async function cronEvent() {

  console.log("cron triggered....x");
  await checkURLS();
  await sendNotifications();
  console.log("post checkURLS()");
}

async function cronEventWrapper() {

  await cronEvent();
  return new Response("Manually triggered Cron function .....", {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  });

}

/*
  All Routing is done using basic string checking. This is sufficient from the POC
  Endpoints that return JSON and classified as APIs these are all under /api/v1
  Endpoints that return html are classified as UIs these are all under /ui/v1  
*/

addEventListener('fetch', event => {
  const _url = event.request.url;
  if (_url.endsWith('/api/v1/addmonitor') && event.request.method === "POST") {
    event.respondWith(addMonitor(event.request));
  }
  else if (_url.endsWith('/api/v1/crontrigger') && event.request.method === "GET") {
    event.respondWith(cronEventWrapper());
  }
  else if (_url.endsWith('/api/v1/list') && event.request.method === "GET") {
    event.respondWith(listURLS(event.request));
  }
  else if (_url.endsWith('/api/v1/checkURLS') && event.request.method === "GET") {
    event.respondWith(checkURLS());
  }
  else if (_url.endsWith('/ui/v1/status') && event.request.method === "GET") {
    event.respondWith(displayStatus());
  }
  else if (_url.endsWith('/ui/v1/addMonitorForm') && event.request.method === "GET") {
    event.respondWith(addMonitorForm());
  }
  // test URL used for DEBUGGING email send process not to be used in production, need to edit sendmail to return a response if used. 
  else if (_url.endsWith('/ui/v1/sendemail') && event.request.method === "GET") {
    event.respondWith(sendEmail(true,"https://amazon.co.uk/"));
  }
  else if ((_url.endsWith('/ui/v1/') || _url.endsWith('/')) && event.request.method === "GET") {
    event.respondWith(homePage());
  }
  else {
    event.respondWith(handleRequest(event.request));
  }
})

/*
  If we havent recognised the path on the request then return a 404
*/

async function handleRequest(request) {
  const returnString = `URL ${request.url} not recognised for request type ${request.method}`;
  return new Response(returnString, {
    headers: { 'content-type': 'text/html' },
    status: 404,
  })
}

/*
  Return a list of URLS that are currently configured.
*/

async function listURLS(request) {

  const value = await getAllKVs();
  return new Response(JSON.stringify(value))
}

/*
  Very basic home page linking off to other UI pages. 
*/

async function homePage(request) {

  let html = `<head><style></style></head><body>
  <p><a href="/ui/v1/status">Status Page</a></p>
  <p><a href="/ui/v1/addMonitorForm">Add New Monitor</a></p>
  <p><a href="/api/v1/list">List Monitors</a></p>
  <p><a href="/api/v1/crontrigger">Execute Manual Check</a></p>`
    ;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  });

}

/*
  display the current status object in a tabular form. Test the styling capabilities to ensure 
  a worker can produce nice looking output.
*/
async function displayStatus() {

  _status = await getStatus(true);

  if (_status == null) {
    return new Response("No status found, try again soon", {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
    });
  }

  let html = `<head><style> .styled-table {
    border-collapse: collapse;
    margin: 25px 0;
    font-size: 0.9em;
    font-family: sans-serif;
    min-width: 400px;
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.15);
}
.styled-table thead tr {
  background-color: #009879;
  color: #ffffff;
  text-align: left;
}
.styled-table th,
.styled-table td {
    padding: 12px 15px;
}
.styled-table tbody tr {
  border-bottom: 1px solid #dddddd;
}

.styled-table tbody tr:nth-of-type(even) {
  background-color: #f3f3f3;
}

.styled-table tbody tr:last-of-type {
  border-bottom: 2px solid #009879;
}
.styled-table tbody tr.active-row {
  font-weight: bold;
  color: #009879;
}

</style></head><body><table class="styled-table"><tr><th>URL</th><th>Last Success</th><th>Last Fail</th><th>Frequency (secs)</th></tr>`;

  for (item of _status.urls) {
    const monitor = JSON.parse(await KV.get(item.name));
    html += `<tr><td>${item.name}</td><td>${item.last_success == null || item.last_success === "" ? "" : getDateTimeFromTimestamp(parseInt(item.last_success))}</td>
    <td>${item.last_failed == null || item.last_failed === "" ? "" : getDateTimeFromTimestamp(parseInt(item.last_failed))}</td><td>${monitor == null ? "?" : monitor.frequency}</td></tr>`
  }

  html += `</table>
  <p><a href="/ui/v1/">Home Page</a></p>
  <body>`

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  });

}

// helper method to convert the unix time stamp to a human readable form

function getDateTimeFromTimestamp(unixTimeStamp) {
  let date = new Date(unixTimeStamp);
  return ('0' + date.getDate()).slice(-2) + '/' + ('0' + (date.getMonth() + 1)).slice(-2) + '/' + date.getFullYear() + ' ' + ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
}


/*
  Add a new value to the KV for a new URL to be included in the check. This can either be called from the UI in this worker or directly from the API (via postman?)
  This method handles both these approaches as the payload is slightly different.
*/

async function addMonitor(request) {

  // Only One monitor per URL can be created because the KV name is unique. If a monitor already exists the new data will overwrite the existsing one.
  console.log("in addMonitor()");
  let monitor_to_add = "";
  const contentType = request.headers.get("content-type") || "";
  console.log(`contentType : ${contentType}`);
  // request come via form UI page /ui/v1/addMonitorForm
  if (contentType.includes("form")) {
    console.log("in form if");
    const formData = await request.formData();
    console.log(`formData : ${Object.fromEntries(formData)}`);
    const body = Object.fromEntries(formData);
    console.log(body);
    monitor_to_add = body;
  }
  // request come via /api/v1/addMonitor using JSON (via postman?)
  else if (contentType.includes("application/json")) {
    monitor_to_add = await request.json();
  }
  console.log("pre put");
  const value = await KV.put(monitor_to_add.url_to_monitor, JSON.stringify(monitor_to_add));
  console.log("pre response");
  return new Response(`Monitor added <p><a href="/ui/v1/">Home Page</a></p>`, {
    headers: { 'content-type': 'text/html' },
  })
}

/*
  Displays a UI to get the details to add and then posts these results to the api URL / method above addMonitor()
*/

async function addMonitorForm(request) {

  // Only One monitor per URL can be created because the KV name is unique. If a monitor already exists the new data will overwrite the existsing one.

  const HTML = `
  <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <title>Example: FormData</title>
      <style>
        label {
          display: block;
          margin-top: 1rem;
        }
      </style>
    </head>
    <body>
      <form action="/api/v1/addmonitor" method="POST">
        <label for="url">URL</label>
        <input id="url_to_monitor" name="url_to_monitor" />

        <label for="frequency">Frequency (seconds)</label>
        <input id="frequency" name="frequency" type="number" min="60" step="1"/>

        <label for="email">Email To Alert</label>
        <input id="alert-email" name="alert-email" type="email" />

        <button type="submit">Submit</button>
      </form>
    </body>
  </html>
`;

  return new Response(HTML, {
    headers: { 'content-type': 'text/html' },
  });

}


/*
    Retrieves all the URLs to check and then loops through these using a fetch to check the status of the endpoint.
    There is an object in the KV for each URL that needs to be checked and also a status KV object that holds the
    current status of the URLs.
*/

async function checkURLS() {

  console.log("in checkURLS()");
  _status = await getStatus(true);

  console.log(`status : ${_status}`);

  const allkvs = await getAllKVs();

  console.log(allkvs);

  if (_status === null) {
    // create the status KV 
    console.log(JSON.stringify(allkvs));
    _status = JSON.parse(`{ "urls" : ${JSON.stringify(allkvs)}  }`);
    await KV.put("status", JSON.stringify(_status));
  }

  let rettext = "";

  for (item of allkvs) {

    console.log(`item.name : ${item.name}`);
    const monitor = JSON.parse(await KV.get(item.name));
    console.log(`monitor : ${JSON.stringify(monitor)}`);

    const myInit = {
      method: 'GET'
    };

    let runMe = false;
    const frequncyInSeconds = monitor.frequency == null ? 60 : monitor.frequency;
    let itemToCheck = _status.urls.find(x => x.name === monitor.url_to_monitor)

    // URL must have been recently added as its not in the status object
    if (itemToCheck == null) {
      itemToCheck = JSON.parse(`{"name":"${monitor.url_to_monitor}","last_success":"","last_failed":""}`);
      _status.urls.push(itemToCheck);
    }

    let lastChecked = 0;

    if (itemToCheck.last_success) {
      lastChecked = parseFloat(itemToCheck.last_success);
    }
    if (itemToCheck.last_failed) {
      // last failed more recent
      if (parseFloat(itemToCheck.last_failed) > lastChecked) {
        lastChecked = parseFloat(itemToCheck.last_failed);
      }
    }

    console.log(`monitor.url_to_monitor : ${monitor.url_to_monitor}`);
    console.log(`frequncyInSeconds : ${frequncyInSeconds}`);
    console.log(`itemToCheck : ${itemToCheck}`);
    console.log(`lastChecked : ${lastChecked}`);
    console.log(`Now : ${Date.now()}`);
    console.log(`Times : total ${parseFloat(lastChecked) + parseFloat(frequncyInSeconds)} && ${parseFloat(Date.now())}`);

    if ((parseFloat(lastChecked) + parseFloat(frequncyInSeconds) * 1000) < parseFloat(Date.now())) {
      runMe = true;
    }
    else {
      console.log("No need to run duration not passed since previous");
    }

    if (monitor.url_to_monitor && runMe) {
      const resp = await fetch(`${monitor.url_to_monitor}`, myInit);

      // here need to update the status object

      if (resp.status == "200") {
        UpdateStatus(_status, monitor, { "status": "Passed" });
        rettext = rettext + "\n" + JSON.stringify(monitor) + " OK ";
      }
      else {
        UpdateStatus(_status, monitor, { "status": "Failed" });
        rettext = rettext + "\n" + JSON.stringify(monitor) + " BAD " + resp.status + " Returned";
      }
    }

    await updateStatus();

  }

  return new Response(rettext, {
    headers: { 'content-type': 'text/html' },
  });

}

/*
  Return the names of all the KVs except the status KV, this returns an array like this :
  [{"name":"https://google.com"},{"name":"https://www.bbc.co.uk/news"},{"name":"https://www.microsoft.com/"}]
*/
async function getAllKVs() {
  let res = await KV.list();
  console.log(`in getALLKVs : res : ${res}`);
  // get everyting except the status one
  return res.keys.filter((x) => (x.name !== "status"));
}


/*
  Local Helper method to get the KV details
  returns the value of the KV in a JSON object
*/
async function getKV(name) {
  return await KV.get(name);
}


/*
  Helper method to update the status object in one place
*/

function UpdateStatus(status, url, result) {
  if (url === null) // nothing supplied in the URL
  {
    return;
  }
   const now = Date.now().toString();  // get the GB formatted date and time

  let itemToUpdate = status.urls.find(x => x.name === url.url_to_monitor);

  // dont include history information as the size of the object gets too big too quickly. 
  // need to rethink how the status is tracked, Durable Object or database?
  // if (itemToUpdate && itemToUpdate.history == null)
  // {
  //   itemToUpdate.history = [];
  // } 

  if (result.status === "Failed" && itemToUpdate) {
    itemToUpdate["last_failed"] = now;
    //itemToUpdate.history.push({ "failed" : now });
  }

  if (result.status === "Passed" && itemToUpdate) {
    itemToUpdate["last_success"] = now;
    //itemToUpdate.history.push({ "passed" : now });
  }

}

/*
    status object is used through the functions above. In order that we dont need to constantly requery the KV for this we 
    set the variable at the global scope and only call KV is this variable hasnt been initialised. 
*/

async function getStatus(force) {
  // global variable has not been set yet.
  if (_status == null || _status.urls == null || force) {
    console.log("Getting status from KV");
    _status = await JSON.parse(await KV.get("status")); // we have a status object that holds the results of the queries.
    return _status;
  }
  else {
    console.log(`using previously retreieved status ${JSON.stringify(_status)}`);
    return _status;
  }
}

async function updateStatus() {
  await KV.put("status", JSON.stringify(_status)); // we have a status object that holds the results of the queries.
}

/*
  Called by the cron trigger after all the monitors have been checked and the status object has been updated. 
  This monitor determines if any failure or recovery emails need to be sent. Failure emails are sent when a 
  monitor first fails and then every hour after that while the monitor is not fixed.
  Recovery emails are sent when a monitor recovers after a previous fail. These should only be sent once. 
*/

async function sendNotifications() {

  console.log("in sendNotifications");
  _status = await getStatus();
  statusUpdated = false;

  for (item of _status.urls) {
    let notification = false;
    if (item.last_failed != null) {
      console.log(`we found a failure for ${item.name} for date : ${getDateTimeFromTimestamp(parseInt(item.last_failed))}`);
      // we have a failed monitor.
      if ((item.last_success != null && item.last_failed > item.last_success) || (item.last_success == null || item.last_success === "")) {
        // the failure is more recent than the success, need to notify
        notification = true;
        console.log(`we found a failure for ${item.name} for date : ${getDateTimeFromTimestamp(parseInt(item.last_failed))} this is more recent than the last successful ping at ${getDateTimeFromTimestamp(parseInt(item.last_success))}`);
      }

      if (notification) {
        // check to see if we have notified before.
        console.log(`item.fail_notification_date : ${item.fail_notification_date}`);
        // only send the email if the notification date has not been set or an hour has elapsed since the last notification.
        if (!item.fail_notification_date || ((parseInt(item.last_failed) - parseInt(item.fail_notification_date)) > 3600000)) {
          // send notification cos we havent already.
          console.log("Downtime Notification");
          await sendEmail(true, item.name);
          item["fail_notification_date"] = Date.now();
          item["recovery_notification_date"] = null;
          statusUpdated = true;
          console.log(`item : ${JSON.stringify(item)}`)
        }
      }

      // see if we need to send a recovery notification.
      if ((item.last_success != null && item.last_failed < item.last_success) && item.fail_notification_date < item.last_success && (!item.recovery_notification_date ||
        (item.recovery_notification_date < item.last_failed))) {
        console.log(`recovery notifcation`);
        item["recovery_notification_date"] = Date.now();
        await sendEmail(false, item.name);
        statusUpdated = true;
      }

    }
  }

  if (statusUpdated) {
    await updateStatus();
  }
}

async function sendEmail(failureNotification, url) {

  notificationURL = JSON.parse(await getKV(url));

  if (!notificationURL) {
    console.log(`unable to find KV for ${url}`);
    return;
  }

  var options = {
    "method": "POST",
    "headers": {
      "authorization": MAILGUN_TOKEN,
      "content-type": "multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW",
      "cache-control": "no-cache"
    }
  };

  console.log(`notificationURL : ${notificationURL}`);
  console.log(`notificationURL["alert-email"] : ${notificationURL["alert-email"]}`);
  const to = encodeURIComponent(notificationURL["alert-email"]);
  let body = "";
  let subject = "";
  if (failureNotification) {
    body = encodeURIComponent(`The URL ${url} could not be reached at ${(new Date).toLocaleString('en-GB')}`);
    subject = encodeURIComponent(`The URL ${url} could not be reached at ${(new Date).toLocaleString('en-GB')}`);
  }
  else {
    body = encodeURIComponent(`The URL ${url} has recovered at ${(new Date).toLocaleString('en-GB')}`);
    subject = encodeURIComponent(`The URL ${url} has recovered at ${(new Date).toLocaleString('en-GB')}`);
  }
  const from = encodeURIComponent('Mailgun Sandbox <postmaster@sandbox4b5e63e33cab42baa0457fbc0c93dace.mailgun.org>');

  console.log(`https://api.mailgun.net/v3/sandbox4b5e63e33cab42baa0457fbc0c93dace.mailgun.org/messages?from=${from}&to=${to}&text=${body}&subject=${subject}`);
  console.log(JSON.stringify(options));
  const  resp = await fetch(`https://api.mailgun.net/v3/sandbox4b5e63e33cab42baa0457fbc0c93dace.mailgun.org/messages?from=${from}&to=${to}&text=${body}&subject=${subject}`, options);
  //const resp1 = await fetch(`https://api.eu.mailgun.net/v3/mg.newtonsoftware.net/messages?from=${from}&to=${to}&text=${body}&subject=${subject}`, options);

  console.log(JSON.stringify(resp));
  //console.log(JSON.stringify(resp1));
  //return new Response(`email response : ${JSON.stringify(resp)}`);
}