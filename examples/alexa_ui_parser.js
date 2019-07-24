let alexaState = 'Disconnected';
let alexaStateIpcPath;
let fs = require('fs');

console.log('AVS Sample App UI parser');

process.argv.forEach(function(val, index, array) {
  if (val == '-f') {
    if (process.argv[index + 1]) {
      alexaStateIpcPath = process.argv[index + 1];
    }
  }
});

function setAlexaState(alexaState) {
  fs.writeFile(".avs_state_ipc", alexaState, function(err) {
    if(err) {
      return console.log(err);
    }
  }); 
}

// Function to initialize IPC to parse log of Alexa sample app
/**
 * @return {void}
 */
function initAlexaStateIPC() {
  alexaStateStream = fs.createReadStream(alexaStateIpcPath);

  alexaStateStream.on('data', (chunk) => {
    console.log(chunk.toString());
    if (chunk.indexOf('Listening') >= 0) {
      console.log('Listening');
      alexaState = 'Listening';
      setAlexaState(alexaState);
    }
    else if (chunk.indexOf('Speaking') >= 0) {
      console.log('Speaking');
      alexaState = 'Speaking';
      setAlexaState(alexaState);
    }
    else if (chunk.indexOf('Thinking') >= 0) {
      console.log('Thinking');
    }
    else if (chunk.indexOf('Alexa is currently idle') >= 0) {
      console.log('Alexa Idle');
      alexaState = 'Idle';
      setAlexaState(alexaState);
    }
    else if (chunk.indexOf('Audio state         : STOPPED') >= 0) {
      console.log('Audio state: STOPPED');
      alexaState = 'AudioStopped';
      setAlexaState(alexaState);
    }
    else if (chunk.indexOf('Audio state         : PLAYING') >= 0) {
      console.log('Audio state: PLAYING');
      alexaState = 'AudioPlaying';
      setAlexaState(alexaState);
    }
  });
}

initAlexaStateIPC();
