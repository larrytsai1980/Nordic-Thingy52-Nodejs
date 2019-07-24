sudo kill -9 $(ps aux | grep hw:0,1,2 | awk '{print $2}' )
sleep 1
sudo NOBLE_HCI_DEVICE_ID=2 node /home/pi3/node_modules/thingy52/examples/alexa_thingy.js -d hw:0,1,2 -a xxxxxxxxxxxx -f /home/pi3/.avs_state_ipc
