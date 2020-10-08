const noteNames = [
  "B", "C", "C#", "D",
  "D#", "E", "F", "F#",
  "G", "G#", "A", "A#"
];

const CHUNK_META_LENGTH = 8;
const CHUNK_META_NAME_LENGTH = 4;
const C1_NOTE = 24;

const systemEvents = {
  meta_sequence: 0x00,
  meta_text: 0x01,
  meta_copyright: 0x02,
  meta_trackname: 0x03,
  meta_instrument: 0x04,
  meta_lyrics: 0x05,
  meta_marker: 0x06,
  meta_cue: 0x07,
  meta_channel_prefix: 0x20,
  meta_port: 0x21,
  meta_eot: 0x2F,
  meta_tempo_set: 0x51,
  meta_SMPTEOffset: 0x54,
  meta_time_signature: 0x58,
  meta_key_signature: 0x59,
  meta_sequencer: 0x7F,
};

const midiEvents = {
  note_off: 0x80,
  note_on: 0x90,
  note_after_touch: 0xA0,
  note_control_change: 0xB0,
  note_program_change: 0xC0,
  note_channel_pressure: 0xD0,
  note_pitch_bend: 0xE0,
  system_exclusive: 0xF0
};

function trackNote(id, name, freq, start, duration, vel) {
  this.id = id;
  this.name = name;
  this.freq = freq;
  this.start = start;
  this.duration = duration;
  this.velocity = vel;
}

function Chunk(name, data) {
  this.name = name;
  this.data = data;
}

function Track(name, instrument) {
  this.name = name;
  this.instrument = instrument;
  this.notes = [];
  this.timePassed = 0;
}

Track.prototype.addNote = function(id, vel, chan) {
  let pianoKey = id - C1_NOTE + 1;
  let frequency = (440 / 32) * Math.pow(2, (id - 9) / 12);
  if (pianoKey < 0) {
    // to do
    return this.notes.push(new trackNote(id, "??", frequency, this.timePassed, 0, vel));
  }
  let remainder = pianoKey % 12;
  let level = (remainder === 0) ? (pianoKey / 12) : (pianoKey / 12) + 1;
  if (frequency > 24000) {
    return;
  }
  let noteName = noteNames[remainder] + Math.floor(level);
  this.notes.push(new trackNote(id, noteName, frequency, this.timePassed, 0, vel));
}

Track.prototype.endNote = function(id) {
  if (this.notes.length === 0) return;
  for (let i = this.notes.length - 1; i >= 0; i--) {
    if (this.notes[i].id === id) {
      this.notes[i].duration = this.timePassed - this.notes[i].start;
      break;
    }
  }
}

function Note(name, baseFreq) {
  this.name = name;
  this.baseFreq = baseFreq;
}

function Parser() {
  this.bufferIndex = 0;
  this.currentTrack = 0;
  this.timePassedTotal = 0;
}

Parser.prototype.readValue = function(buffer, offset) {
  let result = buffer[offset.i++];
  let byte = 0;
  if (result & 0x80) {
    result &= 0x7F;
    do {
      byte = buffer[offset.i++];
      result = (result << 7) | (byte & 0x7F);
    } while (byte & 0x80);
  }
  return result;
}

Parser.prototype.readChunk = function() {
  let offset = this.bufferIndex;
  let name = this.buffer.toString('utf8', offset, offset + CHUNK_META_NAME_LENGTH);
  let size = this.buffer.readUInt32BE(offset + CHUNK_META_NAME_LENGTH);
  let data = Buffer.from(this.buffer.buffer, offset + CHUNK_META_LENGTH + this.buffer.byteOffset, size);
  this.bufferIndex += CHUNK_META_LENGTH + size;
  console.log('read chunk', name, size);
  return new Chunk(name, data);
}

Parser.prototype.readTrack = function(buffer) {
  let track = new Track('Track ' + (++this.currentTrack), 'Unknown');
  let previousStatus = 0;
  for (let i = 0; i < buffer.length;) {
    let obj = {i};
    let deltaTime = this.readValue(buffer, obj);
    i = obj.i;
    let status = buffer[i++];
    track.timePassed += deltaTime;
    if (status < 0x80) {
      // Handling compression
      status = previousStatus;
      i--;
    }
    let oldPreviousStatus = previousStatus;
    previousStatus = status;
    let mE = midiEvents;
    if ((status & 0xF0) == mE.note_off) {
      let channel = status & 0x0F;
      let note = buffer[i++];
      let velocity = buffer[i++];
      // console.log('Note off:', note, 'vel:', velocity);
      track.endNote(note);
    } else if ((status & 0xF0) === mE.note_on) {
      let channel = status & 0x0F;
      let note = buffer[i++];
      let velocity = buffer[i++];
      if (velocity == 0) {
        // console.log('Note off:', note, 'vel:', velocity);
        track.endNote(note);
      } else {
        // console.log('Note on:', note, 'vel:', velocity);
        track.addNote(note, velocity, channel);
      }
    } else if ((status & 0xF0) === mE.note_after_touch) {
      let channel = status & 0x0F;
      let note = buffer[i++];
      let velocity = buffer[i++];
    } else if ((status & 0xF0) === mE.note_control_change) {
      let channel = status & 0x0F;
      let note = buffer[i++];
      let velocity = buffer[i++];
    } else if ((status & 0xF0) === mE.note_program_change) {
      let channel = status & 0x0F;
      let program = buffer[i++];
    } else if ((status & 0xF0) === mE.note_channel_pressure) {
      let channel = status & 0x0F;
      let pressure = buffer[i++];
    } else if ((status & 0xF0) === mE.note_pitch_bend) {
      let channel = status & 0x0F;
      let lsb = buffer[i++];
      let msb = buffer[i++];
    } else if ((status & 0xF0) === mE.system_exclusive) {
      // console.log('System exclusive');
      previousStatus = 0;
      if (status == 0xF0 || status == 0xF7) {
        // skip the message
        let message = buffer.toString('utf8', i, i + buffer[i++]);
        i += message.length;
      }
      if (status == 0xFF) {
        let e = systemEvents;
        let metaType = buffer[i++];
        let metaLength = buffer[i++];
        if (metaType === e.meta_sequence) {
          console.log('Sequence number:', buffer[i++], buffer[i++]);
        } else if (metaType == e.meta_text || metaType == e.meta_copyright || metaType == e.meta_trackname ||
                  metaType == e.meta_instrument || metaType == e.meta_lyrics || metaType == e.meta_marker ||
                  metaType == e.meta_cue || metaType == e.meta_sequencer) {
          let message = buffer.toString('utf8', i, i + metaLength);
          i += message.length;
          console.log('Meta (type:', metaType, '):', message);
          if (metaType == e.meta_instrument) {
            track.instrument = message;
          }
          if (metaType == e.meta_trackname) {
            if (this.format === 1 && this.currentTrack === 1) {
              if (track.name === 'Track 1') {
                track.name = message;
              } else {
                track.name += ', ' + message;
              }
            } else {
              track.name = message;
            }
          }
        } else if (metaType === e.meta_channel_prefix) {
          console.log('Channel prefix:', buffer[i++]);
        } else if (metaType == e.meta_eot) {
          // end of track
          break;
        } else if (metaType === e.meta_tempo_set) {
          // to do
          if (track.tempo === undefined) {
            track.tempo |= buffer[i++] << 16;
            track.tempo |= buffer[i++] << 8;
            track.tempo |= buffer[i++] << 8;
            track.rawTempo = track.tempo;
            track.tempo = 60000000 / track.tempo;
          }
        } else if (metaType === e.meta_SMPTEOffset) {
          console.log('SMPTE:', buffer[i++], buffer[i++], buffer[i++], buffer[i++], buffer[i++]);
        } else if (metaType === e.meta_time_signature) {
          track.timeSignature = buffer[i++] + '/' + (2 << buffer[i++]);
          console.log('Time signature:', track.timeSignature);
          console.log('Clocks per tick:', buffer[i++]);
          console.log('32 per 24 clocks:', buffer[i++]);
        } else if (metaType === e.meta_key_signature) {
          console.log('Key signature:', buffer[i++]);
          console.log('Minor key:', buffer[i++]);
        } else if (metaType === e.meta_port) {
          console.log('Port')
        } else {
          previousStatus = oldPreviousStatus;
          console.log('Unknown system event!', metaType);
        }
      }
    } else {
      // unknown status!
      previousStatus = oldPreviousStatus;
      console.log('Unknown midi status!', status);
    }
  }
  if (track.timePassed > this.timePassedTotal) {
    this.timePassedTotal = track.timePassed;
  }
  return track;
}

exports.parser = {
  parseBuffer: function(buffer) {
    let _Parser = new Parser();
    let data = {tracks: [], timeSignature: '1/1', songName: '', tempo: 120};
    _Parser.buffer = buffer;
    let headerChunk = _Parser.readChunk();
    data.format = headerChunk.data.readUInt16BE(0);
    data.tracksNumber = headerChunk.data.readUInt16BE(2);
    data.tickdiv = headerChunk.data.readUInt16BE(4);
    let type = (data.tickdiv & 0x8000) === 0 ? 'metrical timing' : 'timecode';
    data.tickdiv &= 0x7FFF;
    _Parser.format = data.format;
    console.log('Format:', data.format, '\nTracks:', data.tracksNumber, '\nTicks:', data.tickdiv, type);
    for (let i = 0; i < data.tracksNumber; i++) {
      let track = _Parser.readTrack(_Parser.readChunk().data);
      delete track.timePassed;
      if (i === 0 && track.tempo !== undefined) {
        data.tempo = Math.floor(track.tempo);
        data.rawTempo = Math.floor(track.rawTempo);
      }
      data.tracks.push(track);
    }
    if (data.tracks.length > 0 && data.format === 1) {
      if (data.tracks[0].timeSignature !== undefined) {
        data.timeSignature = data.tracks[0].timeSignature;
        delete data.tracks[0].timeSignature;
      }
      if (data.tracks[0].name !== 'Track 1') {
        data.songName = data.tracks[0].name;
      }
    }
    if (data.rawTempo) {
      data.secondsPerTick = (data.rawTempo / data.tickdiv) / 1000000;
      data.songLength = _Parser.timePassedTotal * data.secondsPerTick;
      delete data.rawTempo;
    }
    return data;
  }
};