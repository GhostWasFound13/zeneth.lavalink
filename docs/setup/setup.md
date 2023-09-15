# setup client

```
module.exports = {
   name: "play",
   aliases: ["p"],
   run: async (client, message, args) => {
   
const player = await client.DarkCord.createPlayer({
    guildId: message.guild.id,
    voiceId: message.member.voice.channel.id,
    textId: message.channel.id,
    shardId: message.guild.shardId,
    volume: 100,
    deaf: true,
});

const resolve = await player.search(args.join(" "));
const { loadType, tracks, playlistInfo } = resolve;

if (loadType === "NO_MATCHES" || !tracks.length) return createMessage(message.channelId, {
            content: `No match songs result found!`, })
if (loadType === "PLAYLIST_LOADED") {
    for (const track of tracks) {
        player.queue.add(track, { requester: message.author });
    }
    if (!player.playing && !player.paused) await player.play();
createMessage(message.channelId, {
            content: `Added ${player.queue.length} tracks from ${playlistInfo.name}`,
        }); 
} else if (loadType === "SEARCH_RESULT" || loadType === "TRACK_LOADED") {
    player.queue.add(tracks[0], { requester: message.author });
    if (!player.playing && !player.paused) await player.play();
    createMessage(message.channelId, { content: `Queued ${tracks[0].info.title}` });
} else return;
  }
}
```
