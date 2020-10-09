(() => {
  let get = selector => document.querySelector(selector);

  let currentSong = {
    song: null,
    playing: false,
    elapsed: 0
  }

  let lastTimestamp = undefined;

  let instruments = [
    {aliases: 'piano', name: 'acoustic_grand_piano', device: null},
    {aliases: 'cello', name: 'cello', device: null},
    {aliases: 'guitar', name: 'distortion_guitar', device: null},
    {aliases: 'bass', name: 'electric_bass_finger', device: null},
    {aliases: 'flute', name: 'flute', device: null},
    {aliases: 'voice,vocal,choir', name: 'lead_6_voice', device: null},
    {aliases: 'perc', name: 'taiko_drum', device: null},
    {aliases: 'drum', name: 'taiko_drum', device: null},
    {aliases: 'string', name: 'string_ensemble_1', device: null},
    {aliases: 'synth bass,bass synth,synth', name: 'synth_bass_1', device: null},
    {aliases: 'pad', name: 'pad_3_polysynth', device: null},
    {aliases: 'track', name: 'acoustic_grand_piano', device: null},
    {aliases: 'bell', name: 'tinkle_bell', device: null},
    {aliases: 'cymbal', name: 'reverse_cymbal', device: null}
  ];

  function step(timestamp) {
    if (lastTimestamp === undefined) {
      lastTimestamp = timestamp;
    }
    const elapsed = timestamp - lastTimestamp;
    if (currentSong.playing) {
      currentSong.elapsed += elapsed;
      const percent = currentSong.elapsed / (currentSong.song.songLength * 1000);
      if (percent > 1) {
        currentSong.playing = false;
        currentSong.elapsed = 0;
      }
      if (percent <= 1 && currentSong.playing) {
        currentSong.song.tracks.forEach(track => {
          if (track.notes.length === 0) return;
          track.canvas.style.transform = `translateX(-${percent * 100}%)`;
        });
      }
    }
    lastTimestamp = timestamp;
    window.requestAnimationFrame(step);
  }

  window.requestAnimationFrame(step);

  function parseJSON(string) {
    try {
      return JSON.parse(string);
    } catch(e) {
      return null;
    }
  }

  let createElement = (name, data = {}) => {
    let element = document.createElement(name);
    for (const key in data) {
      element.setAttribute(key, data[key]);
    }
    return element;
  }

  get('#send-midi').addEventListener('click', e => {
    if (!context) {
      console.log(instruments)
      context = new AudioContext();
      instruments.forEach((instrument, i) => {
        Soundfont.instrument(context, instrument.name).then(function(device) {
          console.log(instrument.name, 'loaded')
          instruments[i].device = device;
        });
      })
    }
    get('#midi-file').click();
  });

  get('#midi-file').addEventListener('change', function(e) {
    let file = this.files[0];
    if (!file) return alert("No file selected!");
    let xhr = new XMLHttpRequest();
    let form = new FormData();
    form.append('midiFile', file);
    xhr.open('POST', '/upload_midi_file', true);
    xhr.onload = function(e) {
      let json = parseJSON(this.responseText);
      if (json === null) return console.log('Response', this.responseText);
      console.log('json', json);
      currentSong.song = json.data;
      
      if (currentSong.song.secondsPerTick) {
        let msPerTick = currentSong.song.secondsPerTick * 1000;
        currentSong.song.tracks.forEach(track => {
          track.notes.forEach((note, i) => {
            track.notes[i].start *= msPerTick;
            track.notes[i].duration *= msPerTick;
          });
        });
      }
      renderSong();
    }
    xhr.send(form);
  });
  
  get('#play-midi').addEventListener('click', e => {
    if (!currentSong.song) return;
    currentSong.playing = true;
    currentSong.song.tracks.forEach(track => {
      if (track.muted || track.notes.length === 0) return;
      playTrack(track, 'sawtooth', 0.05);
    });
  });

  get('#pause-midi').addEventListener('click', e => {
    if (!currentSong.song) return;
    stopNotes();
    currentSong.playing = false;
  });

  get('#stop-midi').addEventListener('click', e => {
    if (!currentSong.song) return;
    stopNotes();
    currentSong.playing = false;
    currentSong.elapsed = 0;
  });
  
  let context = null;

  let playNote = async (frequency, duration, volume, type) => {
    return new Promise(resolve => {
      let osc = context.createOscillator();
      let envelope = context.createGain();
      let release = 100; // ms
      envelope.gain.value = volume;
      osc.frequency.value = frequency;
      osc.type = type;
      osc.connect(envelope);
      envelope.connect(context.destination);
      envelope.gain.setValueAtTime(0, context.currentTime);
      envelope.gain.linearRampToValueAtTime(volume + (volume / 3), context.currentTime + (20 / 1000)) // attack
      envelope.gain.exponentialRampToValueAtTime(volume, context.currentTime + (200 / 1000)) // decay
      envelope.gain.linearRampToValueAtTime(volume, context.currentTime + (duration / 1000)) // sustain
      envelope.gain.linearRampToValueAtTime(0.0001, context.currentTime + (duration / 1000) + (release / 1000)) // release
      osc.start(context.currentTime);
      setTimeout(() => {
        osc.stop();
        resolve();
      }, duration + release + 20);
    });
  }

  let playTrack = (track, wave, volume) => {
    // Change timing of all notes according to tempo
    for (const note of track.notes) {
      if (!(note.start >= currentSong.elapsed)) continue;
      note.timeout = setTimeout(() => {
        instruments.forEach(instrument => {
          instrument.aliases.split(',').forEach(alias => {
            if (track.name.toLowerCase().includes(alias)) {
              if (!instrument.device) return;
              instrument.device.play(note.id);
            }
          })
        })
        // first harmonic
        // playNote(note.freq, note.duration, volume, wave, note.id);
        // for (let i = 2; i < 4; i++) {
        //   // play a few overtones at half the volume
        //   playNote(note.freq * i, note.duration, volume / 2, wave, note.id);
        // }
      }, note.start - currentSong.elapsed);
    }
  }

  let stopNotes = () => {
    currentSong.song.tracks.forEach(track => {
      stopTrack(track);
    });
  }
  
  let stopTrack = track => {
    track.notes.forEach(note => {
      if (note.timeout) {
        clearTimeout(note.timeout);
        delete note.timeout;
      }
    });
  }

  function switchTrack() {
    let state = this.getAttribute('state');
    let id = +this.getAttribute('track-id');
    if (state === 'on') {
      this.setAttribute('state', 'off');
      this.classList.add('off');
      this.innerText = 'Off';
      currentSong.song.tracks[id].muted = true;
      if (currentSong.playing) {
        stopTrack(currentSong.song.tracks[id]);
      }
    } else {
      this.setAttribute('state', 'on');
      this.classList.remove('off');
      this.innerText = 'On';
      currentSong.song.tracks[id].muted = false;
      if (currentSong.playing) {
        playTrack(currentSong.song.tracks[id], 'sawtooth', 0.05);
      }
    }
  }

  let renderSong = () => {
    get('.bpm-box').innerText = currentSong.song.tempo + ' BPM';
    get('.signature-box').innerText = currentSong.song.timeSignature;
    get('.name-box').innerText = currentSong.song.songName || "Unknown";
    let tracks = get('.tracks');
    while (tracks.firstChild) {
      tracks.removeChild(tracks.firstChild);
    }
    let compression = Math.floor(15 * (currentSong.song.songLength / 200));
    let songMs = (currentSong.song.songLength * 1000) / compression;
    currentSong.song.tracks.forEach((track, i) => {
      if (track.notes.length === 0) return;
      let wrap = createElement('div', {class: 'track-wrap', 'track-id': i});
      let meta = createElement('div', {class: 'meta'});
      let name = createElement('div', {class: 'name'});
      let btn = createElement('button', {class: 'switch', type: 'button', 'track-id': i, state: 'on'});
      let trackCanvas = createElement('canvas', {class: 'track', height: 600, width: songMs});
      let trackWrapper = createElement('div', {class: 'track-wrapper'});
      trackWrapper.appendChild(trackCanvas);
      name.innerText = track.name;
      btn.innerText = 'On';
      btn.addEventListener('click', switchTrack);
      meta.appendChild(name);
      meta.appendChild(btn);
      wrap.appendChild(meta);
      wrap.appendChild(trackWrapper);
      tracks.appendChild(wrap);
      let ctx = trackCanvas.getContext('2d');
      track.canvas = trackCanvas;
      track.ctx = ctx;
      ctx.fillStyle = "grey";
      ctx.fillRect(0, 0, trackCanvas.width, trackCanvas.height);
      track.notes.forEach(note => {
        let y = (127 - note.id);
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(note.start / compression, y * 5 - i);
          ctx.lineTo((note.start + note.duration) / compression, y * 5 - i);
          ctx.stroke();
        }
      });
    });
  }

})();