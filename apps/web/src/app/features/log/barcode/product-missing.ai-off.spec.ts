import { TestBed } from '@angular/core/testing';
import { aiOff } from '../../../core/testing/ai-off';
import { ProductMissing } from './product-missing';

describe('ProductMissing without AI', () => {
  it('offers manual values and a rescan, not the AI label scan or describe', async () => {
    TestBed.configureTestingModule({ providers: [aiOff()] });
    const fixture = TestBed.createComponent(ProductMissing);
    fixture.componentRef.setInput('barcode', '5281234567890');
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Enter values manually');
    expect(text).not.toContain('Scan the nutrition label');
    expect(text).not.toContain('Describe it instead');
  });
});
