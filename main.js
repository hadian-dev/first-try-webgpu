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
    format: canvasFormat,
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

  // Define vertices
  // prettier-ignore
  const vertices = new Float32Array([
    // X,   Y
    -0.8, -0.8, // first triangle
     0.8, -0.8,
     0.8,  0.8,

    -0.8, -0.8, // second triangle
    -0.8,  0.8,
     0.8,  0.8,
  ]);

  // Create vertex buffer
  const vertexBuffer = device.createBuffer({
    label: 'Cell vertices',
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Copy vertex data to buffer's memory
  device.queue.writeBuffer(vertexBuffer, /*bufferOffset=0*/ 0, vertices);

  // Define vertex data structure
  const vertexBufferLayout = {
    arrayStride: 4 * 2,
    attributes: [
      {
        format: 'float32x2',
        shaderLocation: 0, // Position, see vertex shader
        offset: 0,
      },
    ],
  };

  // Create shader module
  const cellShaderModule = device.createShaderModule({
    label: 'Cell shader',
    code: `@vertex
fn vertexMain(@location(0) pos: vec2f) -> @builtin(position) vec4f {
  return vec4f(pos, 0, 1);
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(1, 0.5, 0.3, 1);
}`,
  });

  // Cell render pipeline
  const cellPipeline = device.createRenderPipeline({
    label: 'Cell pipeline',
    layout: 'auto',
    vertex: {
      module: cellShaderModule,
      entryPoint: 'vertexMain',
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: cellShaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: canvasFormat }],
    },
  });

  passEncoder.setPipeline(cellPipeline);
  passEncoder.setVertexBuffer(0, vertexBuffer);
  passEncoder.draw(vertices.length / 2);

  passEncoder.end();

  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
}

try {
  await main();
} catch (error) {
  showError(error);
}
