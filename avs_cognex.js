const { Pool } = require('pg');
const WebSocket = require('ws');
const CogSocket = require("./cogsocket");
const fs = require('fs');
const axios = require('axios');

// Create a PostgreSQL connection pool
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'airfoil',
    password: '123',
    port: 5432, // Default PostgreSQL port
});


// Connection settings for InSight 3805
const ip = "169.254.26.207:80"
const wsUrl = `ws://${ip}/ws`; // for real-time data
const httpUrl = `http://${ip}`; // for image data
var sessionID = ""; // Example: "cam0/hmi/hs/~e12b16bc"

console.log("Creating new CogSocket(\"" + wsUrl + "\")");
const cogsock = new CogSocket(new WebSocket(wsUrl), null, 2);

// this line is needed to see the log messages from the CogSocket
cogsock.log = console.log;


// The onopen event occurs when the connection is open
cogsock.onopen = function () {
    console.log("CogSocket.onopen");
    if (onOpenHandler) {
      onOpenHandler();
    }
};

cogsock.onclose = function () {
    console.log("CogSocket.onclose");
};

cogsock.onerror = function (err) {
    console.log("CogSocket.onerror " + (err ? err : ""));
};


// The onOpenHandler function is called when the connection is open
function onOpenHandler() {
  console.log("onOpenHandler");
  
  // The cells that we want to monitor. These cells will be returned in the resultChanged event
  const body = {
    "cellNames": ["A0:Z8"]
  };

  // Open a session
  cogsock.post('cam0/hmi' + '/openSession', body, onOpenSession);
}


// The onOpenSession function is called when the session is open
function onOpenSession(data) {
  // Set the sessionID. For example: "cam0/hmi/hs/~e12b16bc"
  sessionID = data;

  // The login data: [username, password, something idk]
  const body = ["admin", "", false];

  // Login
  cogsock.post(sessionID + '/login', body, onLogin);
}


// The onLogin function is called when the login is successful
function onLogin(data) {
  // console.log('onLogin', data);

  cogsock.get('cam0/hmi/state', onStateRead);

  // Turn online mode on
  cogsock.put(sessionID + "/softOnline", true, onSoftOnline);

  cogsock.get('cam0/hmi/state', onStateRead);

  // Add listeners
  cogsock.addListener(sessionID + "/resultChanged", onResultChanged);
  cogsock.addListener("cam0/hmi/stateChanged", onStateChanged)

  // Tell the web server that we are ready to receive data
  sendReady();

  // Start the sequence
  triggerSequence();
  triggerTimerID = setInterval(triggerSequence, 61200); // Call triggerSequence every 1 min 1 sec
  keepAliveTimerID = setInterval(keepAlive, 20000);
}

function onStateChanged(data) {
  console.log(data);
}

function onSoftOnline(data) {
  console.log("softonline", data);
}

function onStateRead(data) {
  console.log(data);
}

// The onResultChanged function is called when the result is changed
// This is where we process the data
function onResultChanged(hmiResult) {
  console.log('onResultChanged', hmiResult);

  // Do stuff here :)
  const imageUrl = httpUrl + hmiResult.acqImageView.layers[0].url;

  // Download the image
  // url: the url of the image
  // destination: the destination to save the image
  downloadImage(imageUrl, hmiResult.id);

  // Write the results to the PostgreSQL database
  writeResults(hmiResult.cells);

  // Tell the server that we are ready
  sendReady();
}

// The sendReady function sends a ready message
function sendReady() {
  console.log('Sending ready...');
  cogsock.post(sessionID + "/ready");
}

// The keepAlive function sends a keep alive message
function keepAlive() {
  console.log('Sending keep alive...');
  cogsock.post(sessionID + "/keepAlive");
}

// Dispose  the session
function dispose() {
  cogsock.post(sessionID + "/dispose", "", function (resp) {
    console.log('dispose', resp);
  });
}


// Download the image
// url: the url of the image
// destination: the destination to save the image
const downloadImage = async (url, destination) => {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(destination);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Error downloading the image:', error);
  }
}

// specific to the gripper lifetime study. Cycle time of the robot is about 61 seconds, and the second image is taken at 4 seconds after the first image
function triggerSequence() {
  console.log('Trigger CamView1')
  // console.log(sessionID);
  trigger();

  setTimeout(() => {
    console.log('Trigger CamView2');
    trigger();
  }, 4000);
}

function trigger() {
  cogsock.post(sessionID + '/manualTrigger', null, onTrigger);
}

function onTrigger(data) {
  if (data !== null) {
    console.log('Trigger Response:', data);
  }
}

// write the results to the PostgreSQL database
// for some reason, parameter must be called result1 instead of result
async function writeResults(result1) {
  // console.log('cells' + JSON.stringify(result.cells).length);
  try {
    // Create an object to hold the indexed data
    const indexedCells = {};

    // Loop through the cells array and index by location
    result1.cells.forEach(cell => {
        indexedCells[cell.location] = cell;
    });
    const part_id = result.acqImageView.id;
    // Define the data to be inserted into the table
    const dataToInsert = {
      part_id: part_id,
      camera_view: indexedCells['C6'].data,
      gripper_x: indexedCells['D6'].data,
      gripper_y: indexedCells['E6'].data,
      gripper_r: indexedCells['F6'].data,
      part_x: indexedCells['G6'].data,
      part_y: indexedCells['H6'].data,
      part_r: indexedCells['I6'].data
    };

    if (dataToInsert.gripper_x === '') {
      console.log("Empty results. Not posting to database");
      return;
    }

    // Construct the INSERT SQL query
    const insertQuery = `INSERT INTO airfoil_pose 
                        (part_id, camera_view, gripper_x, gripper_y, gripper_r, part_x, part_y, part_r) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

    console.log(dataToInsert);

    // Execute the query
    const result = await pool.query(insertQuery, [
      dataToInsert.part_id,
      dataToInsert.camera_view,
      dataToInsert.gripper_x,
      dataToInsert.gripper_y,
      dataToInsert.gripper_r,
      dataToInsert.part_x,
      dataToInsert.part_y,
      dataToInsert.part_r
    ]);

    console.log('Data inserted successfully:', result);
  } catch (error) {
    console.error('Error inserting data:', error);
  }
}