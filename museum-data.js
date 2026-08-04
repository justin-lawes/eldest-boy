// ============================================================================
// MODE 10: THE MUSEUM — content manifest
// ============================================================================
// This is the file you edit. No code in here, just the contents of the gallery.
//
// TO ADD A REAL PAINTING:
//   Drop the image in museum/ and add `image: 'museum/your-file.jpg'` to the
//   entry. The procedural placeholder is skipped whenever `image` is present.
//   Any aspect ratio works — set `w` and `h` (in metres) to match roughly.
//
// TO ADD A REAL STATUE:
//   Drop a .glb in museum/ and add `model: 'museum/your-file.glb'`. It gets
//   auto-scaled and centred on the plinth, so the export's units don't matter.
//
// TO ADD RECORDED GUARD VO:
//   Drop the audio in museum/ and add `audio: 'museum/guard-01.mp3'` to a line.
//   Lines with `audio` play the file; lines without it use the browser voice.
// ============================================================================

export default {

  // --- The room ------------------------------------------------------------
  room: {
    width: 24,        // metres, X axis
    depth: 14,        // metres, Z axis
    height: 9,        // metres
    wallColor: '#6b2b2e',      // oxblood — Orsay / Met 19th-c galleries
    dadoColor: '#3a2820',      // wood panelling below the chair rail
    floorTint: '#8a5a32',      // parquet base tone
    title: 'GALLERY 19 — BROTHERS AND OTHER BROTHERS',
    subtitle: 'THE ELDEST BOY COLLECTION',
  },

  // --- Paintings -----------------------------------------------------------
  // frame: 'fillet' | 'ogee' | 'heavy' | 'tondo'
  // w/h are the canvas size in metres (the frame is added outside that).
  // seed just picks which placeholder gets generated — ignored once you set
  // an `image`.
  paintings: [
    {
      title: 'The Eldest Boy, With Understudy',
      artist: 'Attr. to the Circle of J. Lawes',
      year: 'c. 1847',
      caption: 'The doll was painted first and the boy added around it. The family considered the doll the more reliable likeness.',
      image: 'museum/BabyWithDoll.jpg',
      w: 1.15, h: 1.52, frame: 'heavy',
    },
    {
      title: 'The Roping of the Mandrake',
      artist: 'Unknown, after a Northern herbal',
      year: 'c. 1440',
      caption: 'Historically, the eldest boy was tasked with roping the mandrake to the working dog. The second boy held the lantern and said nothing.',
      image: 'museum/Mandrake.jpg',
      w: 1.45, h: 1.49, frame: 'ogee',
    },
    {
      title: 'Portrait of a Younger Son, Unbothered',
      artist: 'S. Saputo the Elder',
      year: '1839',
      caption: 'Younger sons were painted holding an animal so that the viewer would have something else to look at.',
      image: 'museum/YoungerSon.jpg',
      w: 1.17, h: 1.50, frame: 'tondo',
    },
    {
      title: 'The Announcement of the Record',
      artist: 'Attr. to the Nonstop Dang Workshop',
      year: 'c. 1855',
      caption: 'The record was announced in the spring. It was announced again the following spring, and each spring thereafter.',
      image: 'museum/Announcement.jpg',
      w: 2.30, h: 1.57, frame: 'heavy',
    },
    {
      title: 'Brothers Disagreeing About the Ending',
      artist: 'The Master of the Abrupt Coda',
      year: '1861',
      caption: 'The figure at right has proposed a sudden and unrelated final movement. The figure at left has not yet been told.',
      image: 'museum/BrothersDisagreeing.jpg',
      w: 1.80, h: 1.44, frame: 'ogee',
    },
    {
      title: 'Study of a Boy Holding a Great Many Cables',
      artist: 'Unknown',
      year: 'c. 1858',
      caption: 'The purpose of the cables is not recorded. Contemporary accounts describe him as "confident, but not correct."',
      image: 'museum/ManyCables.jpg',
      w: 1.06, h: 1.55, frame: 'fillet',
    },
    {
      title: 'The Website, Beheld',
      artist: 'A. Wariner of Nashville',
      year: '1863',
      caption: 'Depicts the moment the brothers understood they would build the website instead of finishing the record. Note the serenity.',
      image: 'museum/WebsiteBeheld.jpg',
      w: 1.85, h: 1.27, frame: 'ogee',
    },
    {
      title: 'Two Boys, One Telescope',
      artist: 'Attr. to M. Mulliniks',
      year: '1849',
      caption: 'The boy at left has been looking through the glass since 1849. The boy at right is still waiting to be told what he can see.',
      image: 'museum/Telescope.jpg',
      w: 1.18, h: 1.52, frame: 'heavy',
    },
  ],

  // --- Statues -------------------------------------------------------------
  // pose: 'shoulders' | 'wrestle' | 'handshake' | 'telescope' | 'listening'
  statues: [
    {
      title: 'Fraternal Elevation',
      artist: 'Sculptor unknown',
      year: 'c. 1844',
      caption: 'The elder brother bears the younger. Scholars disagree on whether the younger ever came down.',
      pose: 'shoulders',
    },
    {
      title: 'The Disagreement',
      artist: 'After the Antique',
      year: '1857',
      caption: 'Commissioned to commemorate a dispute over whose turn it was. Both parties considered the work a personal victory.',
      pose: 'wrestle',
    },
    {
      title: 'The Understanding',
      artist: 'Workshop of D. Gold',
      year: '1866',
      caption: 'Two brothers reach an agreement. The agreement was not written down and has since been lost.',
      pose: 'handshake',
    },
    {
      title: 'Sighting the Horizon',
      artist: 'Attr. to M. Mulliniks',
      year: '1851',
      caption: 'One brother points. The other raises the glass. Neither has ever reported what was seen.',
      pose: 'telescope',
    },
    {
      title: 'Awaiting the Stems',
      artist: 'Unknown Portland School',
      year: 'c. 1870',
      caption: 'A figure listens for a sound that has been promised to him. The pose is held indefinitely.',
      pose: 'listening',
    },
  ],

  // --- The guard -----------------------------------------------------------
  // Lines fire in order as you keep crossing the ropes, then hold on the last.
  // Add `audio: 'museum/xx.mp3'` to any line to use a recording instead of the
  // browser voice.
  //
  // guardLines fire at paintings; statueLines fire at statues. Escalation is
  // shared, so the guard keeps getting worse no matter what you crowd.
  statueLines: [
    'DO NOT TOUCH THE JUSTIN STATUE.',
    'SIR. THAT IS MARBLE. IT DOES NOT WANT THIS.',
    'THE JUSTIN STATUE IS NOT A HANDRAIL.',
    'EVERY SINGLE DAY SOMEBODY TOUCHES THE JUSTIN STATUE.',
    'I HAVE GUARDED THAT STATUE LONGER THAN I HAVE KNOWN MY WIFE.',
    'THE OILS ON YOUR HANDS ARE FOREVER. THAT IS NOT AN EXAGGERATION.',
    'HE WOULD NOT HAVE WANTED THIS.',
    'YOU ARE BREATHING ON IT NOW. I CAN SEE YOU BREATHING ON IT.',
    'FINE. TOUCH IT. I AM GOING TO GO SIT DOWN AND THINK ABOUT MY LIFE.',
  ],

  guardLines: [
    'SIR. PLEASE STEP AWAY FROM THE PAINTING.',
    'SIR.',
    'THAT IS A ROPE. THE ROPE MEANS SOMETHING.',
    'I HAVE BEEN DOING THIS FOR TWENTY-TWO YEARS.',
    'DO NOT MAKE ME COME OVER THERE.',
    'I AM ALREADY COMING OVER THERE.',
    'MY SON DOES NOT SPEAK TO ME EITHER.',
    'YOU ARE NOT LOOKING AT IT. YOU ARE LOOKING NEAR IT.',
    'I WAS GOING TO BE A PAINTER.',
    'GO AHEAD. TOUCH IT. SEE WHAT HAPPENS TO BOTH OF US.',
  ],

  guard: {
    radius: 1.9,        // metres from the artwork before he starts
    cooldown: 4000,     // ms between shouts
    rate: 0.92,         // speech rate
    pitch: 0.55,        // speech pitch — low
  },
};
