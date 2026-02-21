const { PDFDocument } = require('pdf-lib');

// Verified 2026 W-4 Field IDs
const FIELDS = {
  firstName: 'topmostSubform[0].Page1[0].Step1a[0].f1_01[0]',
  lastName: 'topmostSubform[0].Page1[0].Step1a[0].f1_02[0]',
  address: 'topmostSubform[0].Page1[0].Step1a[0].f1_03[0]',
  cityStateZip: 'topmostSubform[0].Page1[0].Step1a[0].f1_04[0]',
  single: 'topmostSubform[0].Page1[0].c1_1[0]',
  married: 'topmostSubform[0].Page1[0].c1_1[1]',
  hoh: 'topmostSubform[0].Page1[0].c1_1[2]',
  multipleJobs: 'topmostSubform[0].Page1[0].c1_2[0]',
  step3a: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_06[0]',
  step3b: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_07[0]',
  step3Total: 'topmostSubform[0].Page1[0].f1_08[0]',
  step4a: 'topmostSubform[0].Page1[0].f1_09[0]',
  step4b: 'topmostSubform[0].Page1[0].f1_10[0]',
  step4c: 'topmostSubform[0].Page1[0].f1_11[0]',
};

const SSN_FIELD_CANDIDATES = [
  'topmostSubform[0].Page1[0].Step1b[0].f1_05[0]',
  'topmostSubform[0].Page1[0].Step1b[0].f1_04[0]',
  'topmostSubform[0].Page1[0].Step1a[0].f1_05[0]',
  'topmostSubform[0].Page1[0].Step1a[0].f1_04[1]',
  'topmostSubform[0].Page1[0].f1_05[0]',
  'topmostSubform[0].Page1[0].f1_04[0]'
];

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userData, calcResults, whopToken } = req.body;

    // SECURITY CHECK
    if (!whopToken) {
      return res.status(403).json({ 
        error: 'Payment required',
        message: 'Please complete payment to generate your W-4'
      });
    }

    // Fetch W-4 PDF from IRS
    const pdfResponse = await fetch('https://www.irs.gov/pub/irs-pdf/fw4.pdf');
    if (!pdfResponse.ok) {
      throw new Error('Failed to fetch W-4 PDF from IRS');
    }
    
    const pdfBytes = await pdfResponse.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    // Fill personal info
    setText(form, FIELDS.firstName, upper(userData.firstName));
    setText(form, FIELDS.lastName, upper(userData.lastName));
    setText(form, FIELDS.address, upper(userData.address));
    setText(form, FIELDS.cityStateZip, upper(
      `${userData.city || ''}, ${userData.state || ''} ${userData.zip || ''}`.trim()
    ));

    // SSN
    const ssnField = findFirstTextField(form, SSN_FIELD_CANDIDATES);
    if (ssnField) {
      setText(form, ssnField.name, formatSSN(userData.ssn));
    }

    // Filing status
    const filingMap = {
      'single': FIELDS.single,
      'mfs': FIELDS.single,
      'married': FIELDS.married,
      'widow': FIELDS.married,
      'head': FIELDS.hoh
    };
    if (filingMap[userData.filing]) {
      setCheck(form, filingMap[userData.filing]);
    }

    // Step 2c
    if (calcResults.multipleJobs) {
      setCheck(form, FIELDS.multipleJobs);
    }

    // Step 3
    if (calcResults.childrenCredit > 0) {
      setText(form, FIELDS.step3a, calcResults.childrenCredit.toString());
    }
    if (calcResults.otherCredit > 0) {
      setText(form, FIELDS.step3b, calcResults.otherCredit.toString());
    }
    if (calcResults.totalCredits > 0) {
      setText(form, FIELDS.step3Total, calcResults.totalCredits.toString());
    }

    // Step 4
    if (calcResults.otherIncome > 0) {
      setText(form, FIELDS.step4a, calcResults.otherIncome.toString());
    }
    if (calcResults.deductions > 0) {
      setText(form, FIELDS.step4b, calcResults.deductions.toString());
    }
    if (calcResults.extraWithholding > 0) {
      setText(form, FIELDS.step4c, calcResults.extraWithholding.toString());
    }

    // Flatten and return
    form.flatten();
    const filledPdf = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="W4-2026-TaxFlow.pdf"');
    return res.status(200).send(Buffer.from(filledPdf));

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate PDF' });
  }
};

function setText(form, fieldName, value) {
  try { form.getTextField(fieldName).setText(value || ''); } catch (e) {}
}

function setCheck(form, fieldName) {
  try { form.getCheckBox(fieldName).check(); } catch (e) {}
}

function upper(value) {
  return (value || '').toString().toUpperCase();
}

function formatSSN(ssn) {
  if (!ssn) return '';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return ssn;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function findFirstTextField(form, candidates) {
  for (const name of candidates) {
    try {
      const field = form.getTextField(name);
      field.getText();
      return { name, field };
    } catch (e) {}
  }
  return null;
}
