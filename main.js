const canvas = document.querySelector('canvas');

function showError(message) {
  const errorMessageEl = document.createElement('div');
  errorMessageEl.classList = 'error-message';

  const container = document.createElement('div');
  container.textContent = `Error: ${message}`;
  container.classList = 'container';
  errorMessageEl.appendChild(container);

  console.error('Error: ', message);
  document.body.appendChild(errorMessageEl);
}

async function main() {
  if (!canvas) {
    return showError('Canvas element not found');
  }

  if (!navigator.gpu) {
    return showError('WebGPU not supported on this browser!');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return showError('Failed to find a suitable GPUAdapter device.');
  }

  const device = await adapter.requestDevice();
  if (!device) {
    return showError('Failed to create a WebGPU device.');
  }

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  const context = canvas.getContext('webgpu');
  context.configure({
    device,
    format: canvasFormat, //"bgra8unorm"
  });

  const encoder = device.createCommandEncoder();
  const textureView = context.getCurrentTexture().createView();
  const renderPassDescriptor = {
    colorAttachments: [
      {
        view: textureView,
        clearValue: { r: 0.5, g: 0.2, b: 1.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  };
  const passEncoder = encoder.beginRenderPass(renderPassDescriptor);
  passEncoder.end();

  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
}

try {
  await main();
} catch (error) {
  showError(error);
}
