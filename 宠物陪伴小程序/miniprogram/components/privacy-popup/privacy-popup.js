const privacy = require('../../utils/privacy');

Component({
  properties: {
    show: { type: Boolean, value: false }
  },
  methods: {
    onAgree() {
      this.triggerEvent('agree');
    },
    onCancel() {
      this.triggerEvent('cancel');
    },
    onOpen() {
      privacy.openContract();
    },
    noop() {}
  }
});
