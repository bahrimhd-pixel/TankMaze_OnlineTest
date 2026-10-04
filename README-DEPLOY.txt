TANK MAZE ONLINE 1v1 PLAYTEST

This folder is ready to deploy as a small public WebSocket game server. It adapts the existing two-player prototype to use HTTPS/WSS when hosted. The phones do not communicate directly: both connect to the same online game server. It is still an early prototype; it has one shared room with two player slots, no accounts, and no public matchmaking. Anyone with the deployed link may enter a free slot, so share the link only with your tester.

WHAT I PREPARED
- server.js serves the game page and runs the match referee.
- tank-maze-online.html connects using secure WebSockets automatically when hosted over HTTPS. Mobile aim stays on the last direction after releasing the aim stick.
- render.yaml configures a single Render web service. Keep one instance because the room state is held in server memory.

WHAT YOU NEED TO DO
1. Create or sign in to GitHub and Render. Do not send passwords, codes, or API keys to anyone.
2. Create a new GitHub repository. Upload all files in this folder to the repository root (not the folder itself).
3. In Render, create a Blueprint and connect that repository. Render reads render.yaml and creates the service. Render's free service can go to sleep after inactivity, so the first connection may take a little while to wake it.
4. After deployment, copy the HTTPS URL Render gives you. That same URL is the game link for both phones.

HOW TO PLAY USING A MOBILE HOTSPOT
1. Phone A turns on its Personal Hotspot and has mobile data/internet available. Phone A opens the game link in its browser using its own mobile-data connection.
2. Phone B connects to Phone A's hotspot, then opens the exact same game link in its browser.
3. Player 1 waits on the page; Player 2 joins and the match starts automatically.

No PC, home Wi-Fi, router setup, or inbound firewall changes are needed. The hotspot only shares Phone A's internet connection; the online server still needs internet access. If the hotspot phone has no mobile data/internet, this cloud-hosted setup cannot connect. Keep the Render service running during the test; a service restart disconnects the room and resets the match.

NOTES
- This prototype tests a live two-player match, not scale, matchmaking, accounts, anti-cheat, or production reliability.
- Keep the game link private during this test because the room has no access code and only one two-player room.
- Hosting provider details can change; see Render's official WebSocket and Blueprint documentation before deployment.
