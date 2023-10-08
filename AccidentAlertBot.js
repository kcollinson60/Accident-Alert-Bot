const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const axios = require("axios");
const mysql = require("mysql2/promise");
const fs = require('fs');
require('dotenv').config(); // Load environment variables from .env file

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.CHANNEL_ID;
const roleId = process.env.ROLE_ID;
const targetLat = <coords_go_here>; // Latitude of the target point
const targetLon = <coords_go_here>; // Longitude of the target point
const maxDistance = parseFloat(process.env.MAX_DISTANCE);
const maxCameraDistance = parseFloat(process.env.MAX_CAMERA_DISTANCE);
const minDuplicateDistance = parseFloat(process.env.MIN_DUPLICATE_DISTANCE);
const duplicateAlertInterval = parseInt(process.env.DUPLICATE_ALERT_INTERVAL);
const wazeApiUrl = process.env.WAZE_API_URL;
const camerasFile = process.env.CAMERAS_FILE;

const cameraData = JSON.parse(fs.readFileSync(camerasFile, 'utf8'));

let previousReports = [];
let activeAlerts = {};

// Create a connection pool for MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  sendAccidentAlerts();
  setInterval(sendAccidentAlerts, 60 * 1000); // Fetch alerts every minute
});

client.login(token);

const downloadDirectory = './downloaded_images';

async function sendAccidentAlerts() {
  try {
    const response = await axios.get(wazeApiUrl);

    // Extract the accident and jam reports from the JSON response
    const accidentReports = response.data.alerts.filter((alert) => alert.type === "ACCIDENT" || alert.type === "JAM");

    const channel = client.channels.cache.get(channelId);
    const role = channel.guild.roles.cache.get(roleId);
    
    if (!channel) {
      console.log(`Invalid channel ID: ${channelId}`);
      return;
    }
    
    // Fetch the previously active alerts from the database
    const [activeAlertsFromDB] = await pool.query(
      "SELECT id, uuid FROM alerts WHERE status = 'active'"
    );

    const activeAlerts = accidentReports.filter((report) => {
      const distance = getDistance(targetLat, targetLon, report.location.y, report.location.x);
      return distance <= maxDistance;
    });

    const activeAlertsCount = activeAlerts.length; // Calculate the active accident reports count

    // Update the status of alerts that are no longer active
    for (const alertFromDB of activeAlertsFromDB) {
      const isAlertStillActive = activeAlerts.some(
        (report) => report.uuid === alertFromDB.uuid
      );

      if (!isAlertStillActive) {
        await pool.query(
          "UPDATE alerts SET status = 'inactive' WHERE id = ?",
          [alertFromDB.id]
        );
      }
    }

    insertActiveAlertsCount(activeAlertsCount);


    const newReports = getNewReports(accidentReports);
    if (newReports.length === 0) {
      return; // No new accident reports found, no need to send a notification
    }

    for (const report of newReports) {
      if (isNewAlert(report)) {
      const distance = getDistance(targetLat, targetLon, report.location.y, report.location.x);
      if (distance <= maxDistance) {
        const nearestCamera = findNearestCamera(report.location.y, report.location.x, maxCameraDistance);
        const address = await reverseGeocode(report.location.y, report.location.x);

        const embed = new EmbedBuilder()
          .setTitle("Traffic Alert")
          .setColor("#ff0000")
          .addFields(
            { name: "Type", value: report.type },
            { name: "Alert Subtype", value: report.subtype || "Unknown" },
            { name: "Reported Location", value: `${report.street || address.street || "Unknown"}, ${report.city || report.nearBy || address.city || "Unknown"}` },
            { name: "Description", value: `${report.reportDescription || 'No Descrip'}`}
          );

        if (nearestCamera) {
          try {
            const randomString = generateRandomString(10);
            const imageUrl = `${nearestCamera.imageUrl}?r=${randomString}`;

            const imageBuffer = await downloadImage(imageUrl);
            const imageFileName = `${randomString}.jpg`;
            const attachment = new AttachmentBuilder(imageBuffer, { name: imageFileName });

            embed.addFields({ name: "Nearest Camera", value: nearestCamera.name })
              .addFields({ name: "Camera Location", value: `${nearestCamera.location.lat}, ${nearestCamera.location.lon}` })
              .setImage(`attachment://${imageFileName}`)
              .setTimestamp();

            channel.send({ content: `Attention! Traffic incident Reported near ${report.street || address.street || 'Unknown'}, ${report.city || address.city || 'Unknown'}.`, embeds: [embed], files: [attachment] });
            
            const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

            const connection = await pool.getConnection();
            try {
              await connection.query(
                "INSERT INTO alerts (type, subtype, location, uuid, location_lat, location_lon, description, camera_name, camera_lat, camera_lon, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  report.type,
                  report.subtype || null,
                  `${report.street || address.street || "Unknown"}, ${report.city || report.nearBy || address.city || "Unknown"}`,
                  report.uuid,
                  report.location.y,
                  report.location.x,
                  report.reportDescription || null,
                  nearestCamera.name || null,
                  nearestCamera.location.lat || null,
                  nearestCamera.location.lon || null,
                  currentTimestamp,
                ]
              );
              await connection.commit();
            } catch (dbError) {
              console.error("Error inserting alert into the database:", dbError);
            } finally {
              connection.release();
            }
          } catch (error) {
            console.error("Error handling the alert:", error);
          }
        } 
      }
    }
  }
    console.log(`Total Active Alerts within ${maxDistance} miles: ${activeAlertsCount}`);  

    previousReports = accidentReports;
  } catch (error) {
    console.error("Error retrieving Accident reports:", error);
  }
}

// Function to insert active alerts count into the 'active_alerts_count' table
async function insertActiveAlertsCount(activeAlertsCount) {
  const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const connection = await pool.getConnection();
  try {
    await connection.query(
      "INSERT INTO active_alerts_count (time, active_alerts_count) VALUES (?, ?)",
      [currentTimestamp, activeAlertsCount]
    );
    await connection.commit();
  } catch (dbError) {
    console.error("Error inserting active alerts count into the 'active_alerts_count' table:", dbError);
  } finally {
    connection.release();
  }
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c;
  return distance;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function findNearestCamera(latitude, longitude, maxDistance) {
  let nearestCamera = null;
  let minDistance = Infinity;

  for (const camera of cameraData) { // Use cameraData instead of trafficCameras
    const distance = getDistance(latitude, longitude, camera.location.lat, camera.location.lon);
    if (distance < minDistance && distance <= maxDistance) {
      minDistance = distance;
      nearestCamera = camera;
    }
  }

  return nearestCamera;
}

function isNewAlert(report) {
  const existingAlert = previousReports.find((alert) => alert.uuid === report.uuid);
  if (existingAlert) {
    const timeDifference = Date.now() - existingAlert.timestamp;
    if (timeDifference < duplicateAlertInterval) {
      const distance = getDistance(
        report.location.y,
        report.location.x,
        existingAlert.camera.location.lat,
        existingAlert.camera.location.lon
      );
      if (distance < minDuplicateDistance) {
        return false;
      }
    }
  }
  return true;
}

function getNewReports(reports) {
  return reports.filter((report) => !previousReports.find((prevReport) => prevReport.uuid === report.uuid));
}

async function reverseGeocode(latitude, longitude) {
  try {
    const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
    const { address } = response.data;
    return {
      city: address.city || "",
      street: address.road || "",
      highway: address.road || "",
    };
  } catch (error) {
    console.error("Error retrieving reverse geocoding data:", error);
    return {};
  }
}

async function downloadImage(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return response.data;
  } catch (error) {
    console.error("Error downloading image:", error);
    return null;
  }
}

function generateRandomString(length) {
  const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
