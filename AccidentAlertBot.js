const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const axios = require("axios");
const fs = require('fs');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

const token = "<Discord_Token_Goes_Here"; // Replace with your bot token
const channelId = "<Discord_Channel_ID>"; // Replace with the ID of the channel to send the alerts
const roleId = "<Discord_Role_ID>"; // Replace with the ID of the role to mention
const targetLat = <Center_Lat>; // Latitude of the target point 55.5555
const targetLon = <Center_Lon>; // Longitude of the target point -55.5555
const maxDistance = 15; // Maximum distance in miles
const maxCameraDistance = .5; // Maximum distance to consider a camera in miles
const minDuplicateDistance = 1; // Minimum distance in miles for considering duplicate alerts
const duplicateAlertInterval = 10 * 60 * 1000; // 10 minutes (in milliseconds)

const cameraData = JSON.parse(fs.readFileSync('Cameras.json', 'utf8')); //Defines Camera List, currently in JSON format

let previousReports = []; // Array to store previous accident reports

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  sendAccidentAlerts();
  setInterval(sendAccidentAlerts, 60 * 1000); // Fetch alerts every 5 minutes
});

client.login(token);

const downloadDirectory = './downloaded_images'; // Specify the directory for downloaded images

async function sendAccidentAlerts() {
  try {
    const response = await axios.get("https://www.waze.com/rtserver/web/TGeoRSS?bottom=41.480736238455194&left=-94.51194763183595&ma=799&mj=200&mu=200&right=-92.92991638183595&top=41.7222676196229&types=alerts,traffic");

    // Extract the police reports from the JSON response
    const reports = response.data.alerts.filter((alert) => alert.type === "POLICE"); //Define Waze Alert type and Subtypes here e.g. POLICE, ACCIDENT, JAM

    const channel = client.channels.cache.get(channelId);
    const role = channel.guild.roles.cache.get(roleId);
    if (!channel) {
      console.log(`Invalid channel ID: ${channelId}`);
      return;
    }

    const newReports = getNewReports(reports);
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
                { name: "Reported Location", value: `${address.street || "Unknown"}, ${address.city || "Unknown"}` },
                { name: "Alert Subtype", value: report.subtype || "Unknown" }
              );
      

              if (nearestCamera) {
                const randomString = generateRandomString(10);
                const imageUrl = `${nearestCamera.imageUrl}?r=${randomString}`;
        
                // Download the image and attach it
                const imageBuffer = await downloadImage(imageUrl);
                const imageFileName = `${randomString}.jpg`; // Use the random string as the filename
                const attachment = new AttachmentBuilder(imageBuffer, { name: imageFileName });
        
                embed.addFields({ name: "Nearest Camera", value: nearestCamera.name })
                  .addFields({ name: "Camera Location", value: `${nearestCamera.location.lat}, ${nearestCamera.location.lon}` })
                  .setImage(`attachment://${imageFileName}`); // Set the image in the embed as the downloaded image
        
                // Send the embed with the attached image
                channel.send({ content: `Attention <@&${roleId}>! There is a new traffic alert near ${address.city || 'Unknown'}.`, embeds: [embed], files: [attachment] });
              } else {
                embed.addFields({ name: "No Nearby Cameras", value: "No nearby cameras found." });
        
                // Send the embed
                channel.send({ content: `Attention <@&${roleId}>! There is a new traffic alert near ${address.city || 'Unknown'}.`, embeds: [embed] });
              }
            }
          }
        }
        
    previousReports = reports; // Update the previous reports
  } catch (error) {
    console.error("Error retrieving Accident reports:", error);
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
