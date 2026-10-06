# Background music tracks

These filenames are referenced by the `TRACKS` object at the top of `scripts.js`:

| Filename | Shown in the music picker as |
| --- | --- |
| `lofi-study-chill.mp3` | Lo-Fi Chill |
| `lofi-study-beats.mp3` | Lo-Fi Study Beats |
| `alex-morgan-lofi-midnight-club-568164.mp3` | Midnight Club |
| `piano-reverie.mp3` | Soft Piano Reverie |

Only one piano track is wired up right now. To add a second piano option (or any new
track), drop the file here and add an entry to `TRACKS` in `scripts.js`, e.g.:

```js
'piano-2': { name: 'Gentle Piano Keys', src: 'music/piano-gentle-keys.mp3' },
```

then add a matching `<option value="piano-2">Gentle Piano Keys</option>` under the
"Piano" `<optgroup>` in `index.html`.
