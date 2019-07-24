/*
  Copyright (c) 2010 - 2017, Nordic Semiconductor ASA
  All rights reserved.
  Redistribution and use in source and binary forms, with or without modification,
  are permitted provided that the following conditions are met:
  1. Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.
  2. Redistributions in binary form, except as embedded into a Nordic
     Semiconductor ASA integrated circuit in a product or a software update for
     such product, must reproduce the above copyright notice, this list of
     conditions and the following disclaimer in the documentation and/or other
     materials provided with the distribution.
  3. Neither the name of Nordic Semiconductor ASA nor the names of its
     contributors may be used to endorse or promote products derived from this
     software without specific prior written permission.
  4. This software, with or without modification, must only be used with a
     Nordic Semiconductor ASA integrated circuit.
  5. Any software provided in binary form under this license must not be reverse
     engineered, decompiled, modified and/or disassembled.
  THIS SOFTWARE IS PROVIDED BY NORDIC SEMICONDUCTOR ASA "AS IS" AND ANY EXPRESS
  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
  OF MERCHANTABILITY, NONINFRINGEMENT, AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
  GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
  HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
  LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
  OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

let Thingy = require('../index');
let Speaker = require('speaker');
let speaker;
let mic = require('mic');
let micInputStream;

let thingyID;
let soundDevice;

let thisThingy = null;
let speakerConfigured = false;
let readyToSend = true;

const AUDIO_BUFFER_SIZE = 80000;
let audio_buffer = new Buffer(AUDIO_BUFFER_SIZE);
let audio_buffer_tail = 0;
let audio_buffer_head = 0;

let oldTemperatureDataCount = 0;
let newTemperatureDataCount = 0;
const WATCH_DOG_TIMEOUT = 5000; // ms

let bufferStatus = 0;
let micStatus = 'Disabled';
let fs = require('fs');

// stream for virtual microphone and virtual speaker

let alexaStateStream;
let alexaState = 'Disconnected';
let alexaStateIpcPath;

let intervalSendAudio = null;

/** Intel ADPCM step variation table */
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

/** ADPCM step size table */
const STEP_SIZE_TABLE = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209,
        230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
        5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];

// ADPCM decoder
/**
 * @param {number} adpcm adpcm encoded data.
 * @return {void}
 */
function adpcmDecode(adpcm) {
    // Allocate output buffer
	pcm = new Buffer(adpcm.data.length*4);
    // The first 2 bytes of ADPCM frame are the predicted value
	let valuePredicted = adpcm.header.readInt16BE(0);
	// The 3rd byte is the index value
	let index = adpcm.header.readInt8(2);

	if (index < 0)
		index = 0;
	if (index > 88)
		index = 88;

	let diff; /* Current change to valuePredicted */
	let bufferStep = false;
	let inputBuffer = 0;
	let delta = 0;
	let sign = 0;
	let step = STEP_SIZE_TABLE[index];

	for (let _in = 0, _out = 0; _in < adpcm.data.length; _out += 2) {
		/* Step 1 - get the delta value */
		if (bufferStep) {
			delta = inputBuffer & 0x0F;
            _in++;
		}
        else {
			inputBuffer = adpcm.data.readInt8(_in);
			delta = (inputBuffer >> 4) & 0x0F;
		}
		bufferStep = !bufferStep;

		/* Step 2 - Find new index value (for later) */
		index += INDEX_TABLE[delta];
		if (index < 0) {
            index = 0;
        }
		if (index > 88) {
            index = 88;
        }

		/* Step 3 - Separate sign and magnitude */
		sign = delta & 8;
		delta = delta & 7;

		/* Step 4 - Compute difference and new predicted value */
		diff = (step >> 3);
		if ((delta & 4) > 0)
			diff += step;
		if ((delta & 2) > 0)
			diff += step >> 1;
		if ((delta & 1) > 0)
			diff += step >> 2;

		if (sign > 0)
			valuePredicted -= diff;
		else
			valuePredicted += diff;

		/* Step 5 - clamp output value */
		if (valuePredicted > 32767)
			valuePredicted = 32767;
		else if (valuePredicted < -32768)
			valuePredicted = -32768;

		/* Step 6 - Update step value */
		step = STEP_SIZE_TABLE[index];

		/* Step 7 - Output value */
		pcm.writeInt16LE(valuePredicted,  _out);
	}

	return pcm;
}

// Thingy Button change handler
/**
 * @param {string} state new button state.
 * @return {void}
 */
function onButtonChange(state) {
  console.log('Button: ' + state);

  if (state === 'Pressed') {
    thisThingy.mic_enable(function(error) {
      console.log('Microphone enabled! ' + ((error) ? error : ''));
    });
    micStatus = 'Enabled';
  }
  else {
    thisThingy.mic_disable(function(error) {
      console.log('Microphone disabled! ' + ((error) ? error : ''));
      micStatus = 'Disabled';
    });
  }
}

// Thingy Temperature sensor handler
/**
 * @param {number} temperature new temperature value in Celsius.
 * @return {void}
 */
function onTemperatureData(temperature) {
  newTemperatureDataCount++;
}

// Thingy Microphone data handler
/**
 * @param {number} adpcm adpcm encoded microphone input data.
 * @return {void}
 */
function onMicData(adpcm) {
  let pcm = adpcmDecode(adpcm, true);
  // console.log('get pcm data', pcm);
  speaker.write(pcm);
}

function convertAndBuffer(data) {
  if (speakerConfigured) {
    let index = 0;

    // Convert from 16 bit stereo channel source
    for (index = 0; index < data.length-1; index+=2) {
      var sample_16 = data.readInt16LE(index);

      if (((audio_buffer_tail + 1) % AUDIO_BUFFER_SIZE) === audio_buffer_head) {
        console.log('Audio buffer full!')
      }
      else {
        // Convert to unsigned 8 bit.
        var sample_8 = parseInt( (((sample_16*125.0)/32768.0) + 125.0), 10);
        audio_buffer.writeUInt8(sample_8, audio_buffer_tail);
        audio_buffer_tail = (audio_buffer_tail + 1) % AUDIO_BUFFER_SIZE;
      }
    }
    if((Math.abs(audio_buffer_tail - audio_buffer_head) > 4000) && (intervalSendAudio === null)) {
      intervalSendAudio = setInterval(sendAudio, 15);
    }
  }
}

// Send buffered audio data Thingy speaker
/**
 * @return {void}
 */
function sendAudio(){
  var ble_packet_size = 135;

  var ble_packet = new Buffer(ble_packet_size);
    //console.log('sendAudio');
    if (((bufferStatus === 0) || (bufferStatus === 2)) && readyToSend)
    {
      readyToSend = false;
      let index = 0;

      for (index = 0; index < ble_packet_size; index++) {
        var sample = audio_buffer.readUInt8(audio_buffer_head);
        ble_packet.writeUInt8(sample, index);
        audio_buffer_head = (audio_buffer_head + 1) % AUDIO_BUFFER_SIZE;
        if (audio_buffer_head === audio_buffer_tail) {
          console.log('Audio buffer empty');
          if(intervalSendAudio != null) {
            clearInterval(intervalSendAudio);
            intervalSendAudio = null;
          }
          ble_packet.fill(sample, index + 1);
          break;
        }
      }
      if(micStatus === 'Disabled') {
        thisThingy.speaker_pcm_write(ble_packet, function(error) {
        });
      }
      readyToSend = true;
    }
}

// Thingy Speacker status data handler
// 0x00 - Finished
// 0x01 - Buffer warning
// 0x02 - Buffer ready
// 0x10 - Packet disregarded
// 0x11 - Invalid command
// Refer to https://nordicsemiconductor.github.io/Nordic-Thingy52-FW/documentation/firmware_architecture.html#arch_sound
/**
 * @param {status} status Thingy speaker buffer status handler.
 * @return {void}
 */
function onSpeakerStatus(status)
{
  bufferStatus = status;
}

function onDiscover(thingy) {
  console.log('Discovered: ' + thingy);
  thisThingy = thingy;

  thingy.on('disconnect', function() {
    console.log('Disconnected!');
    connectThingy();
  });

  thingy.connectAndSetUp(function(error) {
    console.log('Connected! ' + ((error) ? error : ''));
    thingy.on('temperatureNotif', onTemperatureData);
    thingy.on('buttonNotif', onButtonChange);
    thingy.on('MicrophoneNotif', onMicData);
    thingy.button_enable(function(error) {
      console.log('Button enabled! ' + ((error) ? error : ''));
    });

    thingy.speaker_mode_set(2, function(error) {
      console.log('Speaker configure! ' + ((error) ? error : ''));
      speakerConfigured = true;
    });
    thingy.on('speakerStatusNotif', onSpeakerStatus);
    thingy.speaker_status_enable(function(error) {
      console.log('Speaker status start! ' + ((error) ? error : ''));
    });

    thingy.temperature_interval_set(1000, function(error) {
      if (error) {
        console.log('Temperature sensor configure! ' + error);
      }
    });
    thingy.temperature_enable(function(error) {
      console.log('Temperature sensor started! ' + ((error) ? error : ''));
    });
    setInterval(watchDog, WATCH_DOG_TIMEOUT);
    setInterval(getAlexaState, 100);
  });
}

// This function take action according to the state of Alexa
/**
 * @param {string} alexaState State of Alexa sample app
 * @return {void}
 */
function processAlexaState(alexaState) {
  let led;

  if (thisThingy == null) {
    console.log('Thingy is not connected');
    return;
  }

  if (alexaState == 'Disconnected') {
    led = {
      r: 255,
      g: 1,
      b: 1
    };
    thisThingy.led_set(led, function(error) {
      console.log('LED change! ' + ((error) ? error : ''));
    });
  }
  else if (alexaState == 'Idle'){
    micInstance.pause();
    led = {
      r: 1,
      g: 1,
      b: 1
    };
    thisThingy.led_set(led, function(error) {
      console.log('LED change! ' + ((error) ? error : ''));
    });
  }
  else if (alexaState == 'Listening'){
    led = {
      r: 1,
      g: 255,
      b: 255
    };
    thisThingy.led_set(led, function(error) {
      console.log('LED change! ' + ((error) ? error : ''));
    });
  }
  else if (alexaState == 'Speaking') {
    micInstance.resume();
    led = {
      color: 6,
      intensity: 20,
      delay: 1000
    };

    thisThingy.led_breathe(led, function(error) {
      console.log('LED change! ' + ((error) ? error : ''));
    });
  }
  else if (alexaState == 'AudioPlaying') {
    micInstance.resume();
    led = {
      r: 1,
      g: 1,
      b: 1
    };
    thisThingy.led_set(led, function(error) {
      console.log('LED change! ' + ((error) ? error : ''));
    });
  }
  else if (alexaState == 'AudioStopped') {
    micInstance.pause();
    led = {
      r: 1,
      g: 1,
      b: 1
    };
    thisThingy.led_set(led, function(error) {
      console.log('LED change! ' + ((error) ? error : ''));
    });
  }
}


// This function set the Thingy LED according to the state of Alexa
// https://developer.amazon.com/docs/alexa-voice-service/ux-design-attention.html
function getAlexaState() {
  fs.readFile(alexaStateIpcPath, "utf8", (err, data) => {
    if (err) throw err;
    if(alexaState != data){
      console.log('AVS state: ' + alexaState + ' -> ' + data);
      alexaState = data;
      processAlexaState(data);
    }
  });
}


// Watch Dog function to moniter temperature data from Thingy
// If the count keeps the same after timeout, the Thingy is
// in unknown status. Exit this program in such case.
function watchDog() {
  if (newTemperatureDataCount > oldTemperatureDataCount) {
    oldTemperatureDataCount = newTemperatureDataCount;
  }
  else {
    micInstance.stop();
  }
}

function connectThingy() {
  if (!thingyID) {
    Thingy.discover(onDiscover);
  }
  else {
    Thingy.discoverById(thingyID, onDiscover);
  }
}

console.log('Alexa Voice Servise example with Thingy:52');

process.argv.forEach(function(val, index, array) {
  if (val === '-a') {
    if (process.argv[index + 1]) {
      thingyID = process.argv[index + 1];
    }
  }
  else if (val == '-d') {
    if (process.argv[index + 1]) {
      soundDevice = process.argv[index + 1];
    }
  }
  else if (val == '-f') {
    if (process.argv[index + 1]) {
      alexaStateIpcPath = process.argv[index + 1];
    }
  }
});

if (soundDevice) {
  speaker = new Speaker({
    channels: 1,          // 1 channels
    bitDepth: 16,         // 16-bit samples
    sampleRate: 16000,    // 16kHz sample rate
    samplesPerFrame: 256,
    device: soundDevice
  });
  var micInstance = mic({
    rate: '8000',
    channels: '1',
    debug: true,
    device: soundDevice
  });
  micInputStream = micInstance.getAudioStream();
  micInstance.start();
}
else {
  speaker = new Speaker({
    channels: 1,          // 1 channels
    bitDepth: 16,         // 16-bit samples
    sampleRate: 16000,    // 16kHz sample rate
    samplesPerFrame: 256,
  });
  var micInstance = mic({
    rate: '8000',
    channels: '1',
    debug: true,
  });
  micInputStream = micInstance.getAudioStream();
  micInstance.start();
}

micInputStream.on('data', function(data) {
  // console.log("Recieved Input Stream: " + data.length);
  convertAndBuffer(data);
});

micInputStream.on('stopComplete', function() {
  console.log("Got SIGNAL stopComplete");
  setTimeout(function() {
    process.exit();
  }, 5000);
//  process.exit();
});

process.on('uncaughtException', function(err) {
  // When the recording application close the microphone,
  // the named pipe would be closed and through EPIPE erorr.
  if (err.code === 'EPIPE') {
  }
});

process.on( 'SIGHUP', function() {
  console.log('SIGHUP');
  process.exit();
} )
.on( 'exit', function() {
  console.log('exit!!!');
  process.kill( process.pid, 'SIGTERM' );
} );

connectThingy();
