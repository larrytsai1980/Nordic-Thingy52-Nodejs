sudo kill -9 $(ps aux | grep hw:0,1,0 | awk '{print $2}' )
sleep 1
sudo NOBLE_HCI_DEVICE_ID=0 node /home/pi/node_modules/thingy52/examples/alexa_thingy.js -d hw:0,1,0 -a xxxxxxxxxxxx -f /home/pi/.avs_state_ipc
