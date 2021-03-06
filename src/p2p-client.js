import {EventEmitter} from 'events';
import Signaling from './signaling';

let DEBUG = false;

export default class P2PClient extends EventEmitter {
  constructor(debug = false) {
    super();
    DEBUG = debug;

    this.signaling = new Signaling('wss://p2p-signaling-server.now.sh');
    this.id = this.signaling.id;
    this.signaling.on('open', ({id}) => {
      this.id = id;
      this.emit('ready');
    });
    this.signaling.on('signal', this.onSignal.bind(this));

    this.peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun://stun.l.google.com:19305'
        }
      ]
    });

    this.peer.onicecandidate = event => {
      const {candidate} = event;

      if (!candidate || !this.targetId) {
        return;
      }

      this.signaling.send(this.targetId, {
        type: 'candidate',
        candidate
      });
    };

    this.peer.ondatachannel = event => {
      this.channel = event.channel;
      this.channel.onopen = () => this.onChannelReadyState();
      this.channel.onclose = () => this.onChannelReadyState();
      this.channel.onmessage = message => this.onChannelMessage(message);
    };
  }

  onSignal({signal, sourceId}) {
    this.targetId = sourceId;
    const {type, offer, answer, candidate} = signal;

    switch (type) {
      case 'offer':
        this.peer
          .setRemoteDescription(offer)
          .then(() => this.peer.createAnswer())
          .then(localAnswer => {
            this.signaling.send(this.targetId, {
              type: 'answer',
              answer: localAnswer
            });
            return localAnswer;
          })
          .then(localAnswer => this.peer.setLocalDescription(localAnswer))
          .catch(error => warn('P2PClient Error (receive offer):', error));
        break;

      case 'answer':
        this.peer.setRemoteDescription(answer);
        break;

      case 'candidate':
        this.peer
          .addIceCandidate(new RTCIceCandidate(candidate))
          .catch(error => warn('P2PClient Error (add candidate):', error));
    }
  }

  connect(targetId) {
    if (!this.id) {
      warn('P2PClient Error (not ready)');
      return;
    }

    this.targetId = targetId;

    this.channel = this.peer.createDataChannel('data', {
      ordered: false,
      reliable: false
    });
    this.channel.binaryType = 'arraybuffer';
    this.channel.onopen = () => this.onChannelReadyState();
    this.channel.onclose = () => this.onChannelReadyState();
    this.channel.onmessage = message => this.onChannelMessage(message);

    this.peer
      .createOffer()
      .then(offer => {
        this.peer.setLocalDescription(offer);
        this.signaling.send(this.targetId, {type: 'offer', offer});
      })
      .catch(error => warn('P2PClient Error (send offer):', error));
  }

  send(data) {
    if (
      this.channel &&
      this.channel.readyState === 'open' &&
      this.channel.bufferedAmount < 1
    ) {
      this.channel.send(data);
    }
  }

  onChannelReadyState() {
    const {readyState} = this.channel;

    if (readyState === 'open') {
      this.emit('open');
    }

    log(`P2PClient Channel readystate: ${readyState}`);
  }

  onChannelMessage(message) {
    this.emit('data', message.data);
  }
}

function log(message) {
  if (DEBUG) {
    console.log(message);
  }
}

function warn(message) {
  if (DEBUG) {
    console.warn(message);
  }
}
