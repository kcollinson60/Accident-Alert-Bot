# Accident-Alert-Bot
A bot that uses the Waze website to send accident alerts to discord

# Basic Setup and dependancies
Testing on Ubuntu 22.04
Using NodeJS v16.9.1 npm 7.21.1

Requires: MySQL DB and Discord Server

I am using PM2 to run the program in the background

Finding the Waze JSON URL is fairly easy, go to https://www.waze.com/live-map/ hit F12 and go to the network tab, look for a URL that looks like this, make sure you are looking at the area you want to receive alerts for and are zoomed in to fit. Put this URL in your .env file.
"https://www.waze.com/live-map/api/georss?top=39.39131847350002&bottom=38.801727573624206&left=-95.82495117187501&right=-93.29370117187501&env=na&types=alerts,traffic"

![image](https://github.com/kcollinson60/Accident-Alert-Bot/assets/106141891/dc11e51e-b7e9-4faa-ba88-339e1a35b8a6)
Example^

Currently refining code, needs a lot of work if you have any questions or input please feel free to join my discord https://discord.gg/t9Twe8Cwc9
Any help or feedback with this program is appreciated
