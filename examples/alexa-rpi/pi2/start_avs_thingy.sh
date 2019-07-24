sudo kill -9 $(ps aux | grep hw:0,1,1 | awk '{print $2}' )
sleep 1
sudo NOBLE_HCI_DEVICE_ID=1 node /home/pi2/node_modules/thingy52/examples/alexa_thingy.js -d hw:0,1,1 -a xxxxxxxxxxxx -f /home/pi2/.avs_state_ipc
