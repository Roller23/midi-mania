const socket = require("socket.io")
const express = require('express')
const fileUpload = require('express-fileupload')
const path = require('path')
const app = express()
const port = 3000
const midiParser = require('./midi-parser').parser;

let currentTrack = null;

app.use(express.static(path.join(__dirname, 'assets')))
app.use(fileUpload())

app.get('/', (req, res) => {
  res.sendFile('index.html', {root: __dirname})
})

app.post('/upload_midi_file', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  let midiFile = req.files.midiFile; // input name
  console.log('Got a file:', midiFile.name)

  if (midiFile.mimetype !== 'audio/mid') {
    return res.status(415).send('Only .mid files are allowed.');
  }
  let result = midiParser.parseBuffer(midiFile.data);
  res.status(200).send(JSON.stringify({data: result}));
})

const server = app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`)
})

const io = socket(server)

io.on('connection', socket => {
  console.log('New socket');

  socket.on('register track', data => {
    currentTrack = data.track;
    socket.emit('track registered');
    console.log('Current track set to', currentTrack);
  });

  socket.on('get current track', () => {
    socket.emit('current track', {track: currentTrack})
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected')
  });
});