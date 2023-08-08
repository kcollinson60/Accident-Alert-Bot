const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});
const token = "<Token_Goes_Here>"; // Replace with your bot token
const channelId = "<Channel_ID>"; // Replace with the ID of the channel to send the alerts
const roleId = "<Role_ID>"; // Replace with the ID of the role to mention
const targetLat = <Center_Location_Lat>; // Latitude of the target point
const targetLon = <Center_Location_Long>; // Longitude of the target point
const maxDistance = 15; // Maximum distance in miles
const maxCameraDistance = 1.5; // Maximum distance to consider a camera in miles
const minDuplicateDistance = 1; // Minimum distance in miles for considering duplicate alerts
const duplicateAlertInterval = 10 * 60 * 1000; // 10 minutes (in milliseconds)

const trafficCameras = [
//List camera image URLs and Locations here
//Example: { name: 'I-35/80 @ East Mix', location: { lat: 41.652686, lon: -93.573860 }, imageUrl: 'https://iowadotsnapshot.us-east-1.skyvdn.com/dmtv01lb.jpg' },
  ];
  

let previousReports = []; // Array to store previous accident reports

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  sendAccidentAlerts();
  setInterval(sendAccidentAlerts, 60 * 1000); // Fetch alerts every 5 minutes
});

client.login(token);

async function sendAccidentAlerts() {
  try {
    //Adjust cordinates in this URL to match your location
    const response = await axios.get("https://www.waze.com/rtserver/web/TGeoRSS?bottom=41.480736238455194&left=-94.51194763183595&ma=799&mj=200&mu=200&right=-92.92991638183595&top=41.7222676196229&types=alerts,traffic");

    // Extract the accident reports from the JSON response
    // "alert.type" and "alert.subtype" are included in this, the types can be found when inspecting the JSON repsonse from Waze under the alert category
    const reports = response.data.alerts.filter((alert) => alert.type === "ACCIDENT" || alert.type === "JAM" || alert.subtype === "HAZARD_ON_ROAD_OBJECT" || alert.subtype === "HAZARD_ON_SHOULDER_CAR_STOPPED");

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
    //This appends a random string to avoid discord caching. This needs changed to upload an attachment instead of an image
    function generateRandomString(length) {
        const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let result = "";
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
          result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
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
              
              //This part will find the nearest camera based off the list above, need to change this so it will send it as an attachment instead of a URL
              if (nearestCamera) {
                const randomString = generateRandomString(10); // Generate a random string of length 10
                const imageUrl = `${nearestCamera.imageUrl}?r=${randomString}`; // Append the random string as a query parameter
              
                embed.addFields({ name: "Nearest Camera", value: nearestCamera.name })
                  .addFields({ name: "Camera Location", value: `${nearestCamera.location.lat}, ${nearestCamera.location.lon}` })
                  .setImage(imageUrl) // Set the image for the embed
                  .setTimestamp();

                  channel.send({ content: `Attention <@&${roleId}>! There is a new traffic alert near ${address.city || 'Unknown'}.` });
                  channel.send({ embeds: [embed] }); // Send the embed with the image attachment
                } else {
                embed.addFields({ name: "No Nearby Cameras", value: "No nearby cameras found." });
                channel.send({ content: `Attention <@&${roleId}>! There is a new traffic alert near ${address.city || 'Unknown'}.` });
                channel.send({ embeds: [embed] });
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

  for (const camera of trafficCameras) {
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
