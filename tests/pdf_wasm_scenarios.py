"""Synthetic ICC/PostScript PDF rendering under the real Pages CSP and worker.

No customer document bytes enter fixtures, logs, artifacts or the repository.
"""
import base64
import json
from browser_harness import ROOT


def color_pdf(*, long_name=False):
    profile = (ROOT/'netunim-orders/site/assets/vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc').read_bytes()
    def stream(dictionary, data):
        return b'<< '+dictionary+b' /Length '+str(len(data)).encode()+b' >>\nstream\n'+data+b'\nendstream'
    content = b'q /CS1 cs 0 1 1 0 scn 0 0 48 64 re f Q q 48 0 48 64 re W n 1 0 0 1 48 0 cm /Sh1 sh Q'
    extra = b' /'+b'A'*1111+b' true' if long_name else b''
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 96 64] /Resources << /ColorSpace << /CS1 [/ICCBased 5 0 R] >> /Shading << /Sh1 6 0 R >>'+extra+b' >> /Contents 4 0 R >>',
        stream(b'', content), stream(b'/N 4 /Alternate /DeviceCMYK', profile),
        b'<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 48 0] /Function 7 0 R /Extend [true true] >>',
        stream(b'/FunctionType 4 /Domain [0 1] /Range [0 1 0 1 0 1]', b'{ dup dup }')]
    output = bytearray(b'%PDF-1.7\n'); offsets = [0]
    for number, data in enumerate(objects, 1):
        offsets.append(len(output)); output.extend(f'{number} 0 obj\n'.encode()+data+b'\nendobj\n')
    xref = len(output)
    output.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:
        output.extend(f'{offset:010} 00000 n \n'.encode())
    output.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(output)


def render_colors(browser, module, *, long_name=False, verify_color=True):
    script = """(async()=>{
      const module=await import(MODULE),runtime=await module.preloadPdfSearchRuntime();
      let rendered;const painting=new Promise(resolve=>{rendered=resolve});
      class ObservedBus extends runtime.pdfjsViewer.EventBus{
        dispatch(name,event){super.dispatch(name,event);if(name==='pagerendered')rendered(event.error?String(event.error):'ok')}
      }
      const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;width:500px;height:500px';document.body.append(host);
      const view=await module.createPdfSearchViewer({host,data:Uint8Array.from(atob(DATA),c=>c.charCodeAt(0)),query:'',
        runtime:{...runtime,pdfjsViewer:{...runtime.pdfjsViewer,EventBus:ObservedBus}}});
      try{
        const painted=await painting,canvas=host.querySelector('canvas'),context=canvas.getContext('2d');
        const pixel=(x,y)=>Array.from(context.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*y),1,1).data);
        return {painted,red:pixel(.25,.5),gray:pixel(.75,.5),notice:document.getElementById('vendor-version-notice')?.textContent||''};
      }finally{await view.destroy();host.remove()}
    })()""".replace('MODULE', json.dumps(module)).replace('DATA', json.dumps(base64.b64encode(color_pdf(long_name=long_name)).decode()))
    result = browser.evaluate(script, timeout=45)
    assert result['painted'] == 'ok', result
    if verify_color:
        assert result['red'][0] > 150 and result['red'][1] < 130 and result['red'][2] < 130, result
    assert max(result['gray'][:3])-min(result['gray'][:3]) < 4 and 70 < result['gray'][0] < 190, result
    return result


def wasm_runtime(browser, module):
    # A specific WASM grant must not authorize JavaScript string compilation.
    # CDP defaults to bypassing CSP for debugger evaluations. Turn that off for
    # these policy assertions; real PDF.js worker code never has that exemption.
    def evaluate_csp(expression):
        result = browser.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True,
            'awaitPromise': True, 'allowUnsafeEvalBlockedByCSP': False}, timeout=30)['result']
        assert 'exceptionDetails' not in result, result
        return result['result'].get('value')
    assert evaluate_csp("(()=>{try{new Function('return 1');return false}catch(error){return error instanceof EvalError}})()")
    expected = browser.drain_serious_errors()
    assert all('unsafe-eval' in row or 'Evaluating a string as JavaScript' in row for row in expected), expected
    before = len(browser.events)
    result = render_colors(browser, module)
    assert not result['notice'], result
    compiled = evaluate_csp("""(async()=>{const result=[];for(const name of ['qcms_bg.wasm','jbig2.wasm','openjpeg.wasm','quickjs-eval.wasm']){
      const response=await fetch('./assets/vendor/pdfjs/wasm/'+name);if(!response.ok)throw Error(name+': '+response.status);
      await WebAssembly.compile(await response.arrayBuffer());result.push(name)
    }return result})()""")
    assert len(compiled) == 4
    assert not browser.drain_serious_errors()
    warnings = [event.get('params', {}).get('entry', {}).get('text', '') for event in browser.events[before:]]
    assert not any('Warning:' in text for text in warnings), warnings
    return {'iccAndPostScriptPainted': True, 'pdfWasmModulesCompiled': compiled, 'javascriptEvalBlocked': True}
